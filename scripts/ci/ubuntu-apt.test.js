const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { parse } = require("yaml");
const { configureUbuntuApt } = require("./ubuntu-apt");

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "electrify-apt-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, "sources.list.d"));
  fs.mkdirSync(path.join(directory, "apt.conf.d"));
  return directory;
}

test("hosted Jammy sources bypass the failing mirror transport and preserve signed suites", (t) => {
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
  configureUbuntuApt(directory);
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
  configureUbuntuApt(directory);
  assert(!fs.readFileSync(file, "utf8").includes("mirror+file:"));
});

test("legacy Azure and deb822 sources retain keys, components and unrelated repositories", (t) => {
  const directory = fixture(t);
  const legacy = path.join(directory, "sources.list");
  const modern = path.join(directory, "sources.list.d/ubuntu.sources");
  const thirdParty = path.join(directory, "sources.list.d/vendor.list");
  fs.writeFileSync(
    legacy,
    "deb http://azure.archive.ubuntu.com/ubuntu/ jammy main\ndeb-src https://azure.archive.ubuntu.com/ubuntu jammy main\n",
  );
  fs.writeFileSync(
    modern,
    "Types: deb\nURIs: mirror+file:/etc/apt/apt-mirrors.txt/\nSuites: noble noble-updates\nComponents: main universe\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n\nTypes: deb\nURIs: https://security.ubuntu.com/ubuntu/\nSuites: noble-security\nComponents: main universe\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n",
  );
  const vendor =
    "deb https://packages.microsoft.com/ubuntu/22.04/prod jammy main\n# http://azureXarchiveXubuntuXcom/ubuntu/ is not the Azure host\n";
  fs.writeFileSync(thirdParty, vendor);
  configureUbuntuApt(directory);
  assert.equal(
    fs.readFileSync(legacy, "utf8"),
    "deb https://archive.ubuntu.com/ubuntu/ jammy main\ndeb-src https://archive.ubuntu.com/ubuntu/ jammy main\n",
  );
  assert.equal(fs.readFileSync(thirdParty, "utf8"), vendor);
  assert.match(
    fs.readFileSync(modern, "utf8"),
    /URIs: https:\/\/archive\.ubuntu\.com\/ubuntu\//,
  );
  assert.match(
    fs.readFileSync(modern, "utf8"),
    /URIs: https:\/\/security\.ubuntu\.com\/ubuntu\//,
  );
  assert.match(
    fs.readFileSync(modern, "utf8"),
    /Signed-By: \/usr\/share\/keyrings\/ubuntu-archive-keyring\.gpg/,
  );
});

test("unrecognized sources and configuration write errors remain fatal", (t) => {
  const directory = fixture(t);
  const source = path.join(directory, "sources.list");
  fs.writeFileSync(source, "deb https://unknown.example/ubuntu jammy main\n");
  assert.throws(
    () => configureUbuntuApt(directory),
    /No supported Ubuntu apt source/,
  );
  assert(!fs.existsSync(path.join(directory, "apt.conf.d/99electrify-ci")));
  fs.writeFileSync(
    source,
    "deb https://archive.ubuntu.com/ubuntu/ jammy main\n",
  );
  fs.mkdirSync(path.join(directory, "apt.conf.d/99electrify-ci"));
  assert.throws(() => configureUbuntuApt(directory), { code: "EISDIR" });
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
