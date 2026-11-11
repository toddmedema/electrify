const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { parse } = require("yaml");
const { configureUbuntuApt, selectMirror } = require("./ubuntu-apt");

function metadata(url) {
  const suite = new URL(url).pathname.split("/").at(-2);
  return new Response(`-----BEGIN PGP SIGNED MESSAGE-----
Hash: SHA512

Origin: Ubuntu
Suite: ${suite}
Codename: ${suite.split("-")[0]}
-----BEGIN PGP SIGNATURE-----
fixture
-----END PGP SIGNATURE-----
`);
}
const healthy = { request: async (url) => metadata(url) };

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "electrify-apt-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, "sources.list.d"));
  fs.mkdirSync(path.join(directory, "apt.conf.d"));
  return directory;
}

test("hosted Jammy sources bypass the failing mirror transport and preserve signed suites", async (t) => {
  const directory = fixture(t);
  const file = path.join(directory, "sources.list");
  const before = [
    "# Runner ubuntu22/20261101.347 uses a prioritized mirror list.",
    ...["jammy", "jammy-updates", "jammy-backports", "jammy-security"].map(
      (suite) =>
        `deb [signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] mirror+file:/etc/apt/apt-mirrors.txt ${suite} main restricted universe multiverse`,
    ),
    "",
  ].join("\n");
  fs.writeFileSync(file, before);
  await configureUbuntuApt(directory, healthy);
  assert.equal(
    fs.readFileSync(file, "utf8"),
    before.replaceAll(
      "mirror+file:/etc/apt/apt-mirrors.txt",
      "https://archive.ubuntu.com/ubuntu/",
    ),
  );
  assert.equal(
    fs.readFileSync(path.join(directory, "apt.conf.d/99electrify-ci"), "utf8"),
    'Acquire::Retries "3";\nAcquire::http::Timeout "30";\nAcquire::https::Timeout "30";\nAPT::Update::Error-Mode "any";\n',
  );
  await configureUbuntuApt(directory, healthy);
  assert(!fs.readFileSync(file, "utf8").includes("mirror+file:"));
});

test("legacy Azure and deb822 sources retain keys, components and unrelated repositories", async (t) => {
  const directory = fixture(t);
  const legacy = path.join(directory, "sources.list");
  const modern = path.join(directory, "sources.list.d/ubuntu.sources");
  const thirdParty = path.join(directory, "sources.list.d/vendor.list");
  fs.writeFileSync(
    legacy,
    "deb http://azure.archive.ubuntu.com/ubuntu/ jammy main\ndeb-src https://azure.archive.ubuntu.com/ubuntu jammy main\n",
  );
  const modernBefore =
    "Types: deb\nURIs: mirror+file:/etc/apt/apt-mirrors.txt/\nSuites: noble noble-updates\nComponents: main universe\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n\nTypes: deb\nURIs: https://security.ubuntu.com/ubuntu/\nSuites: noble-security\nComponents: main universe\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n";
  fs.writeFileSync(modern, modernBefore);
  const vendor =
    "deb https://packages.microsoft.com/ubuntu/22.04/prod jammy main\n# http://azureXarchiveXubuntuXcom/ubuntu/ is not the Azure host\n";
  fs.writeFileSync(thirdParty, vendor);
  await configureUbuntuApt(directory, healthy);
  assert.equal(
    fs.readFileSync(legacy, "utf8"),
    "deb https://archive.ubuntu.com/ubuntu/ jammy main\ndeb-src https://archive.ubuntu.com/ubuntu/ jammy main\n",
  );
  assert.equal(fs.readFileSync(thirdParty, "utf8"), vendor);
  assert.equal(
    fs.readFileSync(modern, "utf8"),
    modernBefore
      .replaceAll(
        "mirror+file:/etc/apt/apt-mirrors.txt/",
        "https://archive.ubuntu.com/ubuntu/",
      )
      .replaceAll(
        "https://security.ubuntu.com/ubuntu/",
        "https://archive.ubuntu.com/ubuntu/",
      ),
  );
});

test("unrecognized sources and configuration write errors remain fatal", async (t) => {
  const directory = fixture(t);
  const source = path.join(directory, "sources.list");
  fs.writeFileSync(source, "deb https://unknown.example/ubuntu jammy main\n");
  await assert.rejects(
    configureUbuntuApt(directory, healthy),
    /No supported Ubuntu apt source/,
  );
  assert(!fs.existsSync(path.join(directory, "apt.conf.d/99electrify-ci")));
  fs.writeFileSync(
    source,
    "deb https://archive.ubuntu.com/ubuntu/ jammy main\n",
  );
  fs.mkdirSync(path.join(directory, "apt.conf.d/99electrify-ci"));
  await assert.rejects(configureUbuntuApt(directory, healthy), {
    code: "EISDIR",
  });
});

test("archive DNS and HTTP failures select the first healthy independent mirror for every configured pocket", async (t) => {
  for (const failure of ["DNS", "HTTP"]) {
    const directory = fixture(t);
    const file = path.join(directory, "sources.list");
    const suites = [
      "jammy",
      "jammy-updates",
      "jammy-backports",
      "jammy-security",
    ];
    const before = suites
      .map(
        (suite) =>
          `deb [signed-by=/ubuntu-key.gpg] https://archive.ubuntu.com/ubuntu/ ${suite} main universe\n`,
      )
      .join("");
    fs.writeFileSync(file, before);
    const requests = [];
    const mirror = await configureUbuntuApt(directory, {
      request: async (url, options) => {
        requests.push(url);
        assert.equal(options.redirect, "error");
        assert(options.signal instanceof AbortSignal);
        if (new URL(url).hostname === "archive.ubuntu.com") {
          if (failure === "DNS")
            throw new Error("fetch failed", { cause: { code: "EAI_AGAIN" } });
          return new Response("unavailable", { status: 503 });
        }
        return metadata(url);
      },
    });
    const expectedMirror = "https://mirror.csclub.uwaterloo.ca/ubuntu/";
    assert.equal(
      fs.readFileSync(file, "utf8"),
      before.replaceAll("https://archive.ubuntu.com/ubuntu/", expectedMirror),
    );
    assert.equal(mirror, expectedMirror);
    assert.deepEqual(
      requests,
      ["https://archive.ubuntu.com/ubuntu/", mirror].flatMap((base) =>
        suites.map((suite) => `${base}dists/${suite}/InRelease`),
      ),
    );
    // A later setup invocation recognizes the previously selected mirror too.
    assert.equal(
      await configureUbuntuApt(directory, healthy),
      "https://archive.ubuntu.com/ubuntu/",
    );
  }
});

test("all mirrors failing leaves sources and existing apt policy untouched", async (t) => {
  const directory = fixture(t);
  const file = path.join(directory, "sources.list");
  const config = path.join(directory, "apt.conf.d/99electrify-ci");
  const before = "deb https://archive.ubuntu.com/ubuntu/ jammy main\n";
  fs.writeFileSync(file, before);
  fs.writeFileSync(config, "existing policy\n");
  const requests = [];
  await assert.rejects(
    configureUbuntuApt(directory, {
      request: async (url) => {
        requests.push(url);
        throw new Error("fetch failed", { cause: { code: "EAI_AGAIN" } });
      },
    }),
    /No reachable Ubuntu apt mirror:[\s\S]*archive\.ubuntu\.com[\s\S]*uwaterloo\.ca[\s\S]*clarkson\.edu/,
  );
  assert.equal(requests.length, 3);
  assert.equal(fs.readFileSync(file, "utf8"), before);
  assert.equal(fs.readFileSync(config, "utf8"), "existing policy\n");
});

test("selection reaches the second independent mirror when earlier candidates fail", async () => {
  const mirror = await selectMirror(["jammy", "jammy-security"], {
    request: async (url) =>
      new URL(url).hostname === "mirror.clarkson.edu"
        ? metadata(url)
        : new Response("unavailable", { status: 503 }),
  });
  assert.equal(mirror, "https://mirror.clarkson.edu/ubuntu/");
});

test("a successful HTTP status with wrong or incomplete release metadata cannot select a mirror", async () => {
  for (const invalid of [
    "<html>maintenance</html>",
    await metadata("https://example.test/dists/noble/InRelease").text(),
    (
      await metadata("https://example.test/dists/jammy/InRelease").text()
    ).replace("Origin: Ubuntu", "Origin: other"),
  ]) {
    const mirror = await selectMirror(["jammy"], {
      request: async (url) =>
        new URL(url).hostname === "archive.ubuntu.com"
          ? new Response(invalid)
          : metadata(url),
    });
    assert.equal(mirror, "https://mirror.csclub.uwaterloo.ca/ubuntu/");
  }
});

test("the mirror deadline covers a stalled response body before falling back", async () => {
  const mirror = await selectMirror(["jammy"], {
    timeoutMs: 5,
    request: async (url, { signal }) => {
      if (new URL(url).hostname !== "archive.ubuntu.com") return metadata(url);
      return {
        ok: true,
        text: () =>
          new Promise((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error("deadline did not abort the body")),
              100,
            );
            signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                reject(signal.reason);
              },
              { once: true },
            );
          }),
      };
    },
  });
  assert.equal(mirror, "https://mirror.csclub.uwaterloo.ca/ubuntu/");
});

test("all apt-consuming jobs prepare sources and fail on setup or installation errors", (t) => {
  const directory = fixture(t);
  const bin = path.join(directory, "bin");
  fs.mkdirSync(bin);
  for (const command of ["sudo", "npx"])
    fs.writeFileSync(
      path.join(bin, command),
      `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.APT_TEST_LOG, JSON.stringify(args) + '\\n');
const stage = args.includes('scripts/ci/ubuntu-apt.js') ? 'prepare' : ${command === "sudo" ? "args[1]" : "'playwright'"};
process.exit(stage === process.env.APT_TEST_FAIL_STAGE ? 100 : 0);
`,
      { mode: 0o755 },
    );
  const { jobs } = parse(
    fs.readFileSync(".github/workflows/workflow.yml", "utf8"),
  );
  for (const group of ["platform", "browser", "desktop"]) {
    const step = jobs[group].steps.find(({ run }) =>
      run?.includes("ubuntu-apt.js"),
    );
    assert(step, `${group} must prepare apt before installing dependencies`);
    assert.equal(step["continue-on-error"], undefined);
    if (group === "platform")
      assert.equal(step.if, "matrix.platform == 'linux'");
    else assert.equal(step.if, undefined);
    const log = path.join(directory, `${group}.log`);
    const run = (failedStage = "") => {
      fs.writeFileSync(log, "");
      return spawnSync("bash", ["-e", "-c", step.run], {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${bin}${path.delimiter}${process.env.PATH}`,
          APT_TEST_LOG: log,
          APT_TEST_FAIL_STAGE: failedStage,
        },
      });
    };
    assert.equal(run().status, 0, group);
    assert.match(fs.readFileSync(log, "utf8").split("\n")[0], /ubuntu-apt\.js/);
    assert.equal(run("prepare").status, 100, group);
    assert.equal(fs.readFileSync(log, "utf8").trim().split("\n").length, 1);
    for (const stage of group === "platform"
      ? ["update", "install"]
      : ["playwright"])
      assert.equal(run(stage).status, 100, `${group}: ${stage}`);
  }
});
