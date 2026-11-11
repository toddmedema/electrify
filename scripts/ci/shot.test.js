const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { UsageError, parseShotArgs, resolveBaseUrl } = require("../dev/shot");

const cwd = path.resolve("checkout");
const parse = (...argv) => parseShotArgs(argv, { cwd });

test("defaults photograph scenario 108 facilities at one small desktop size", () => {
  assert.deepEqual(parse(), {
    help: false,
    route: "/?scenario=108",
    game: true,
    view: "facilities",
    viewports: [{ width: 1280, height: undefined, label: "1280" }],
    themes: ["light"],
    clip: undefined,
    fullPage: false,
    outDir: path.join(cwd, ".tmp", "shots"),
    name: "s108-facilities",
    delay: 300,
    baseUrl: undefined,
  });
});

test("lists, inline values and flags combine", () => {
  const options = parse(
    "--scenario=4",
    "--view",
    "insights",
    "--viewports",
    "1280, 390,390,360x700",
    "--theme",
    "dark,light",
    "--clip",
    ".facilityRow:has-text('Solar')",
    "--out",
    "elsewhere",
    "--delay=0",
    "--base-url",
    "http://127.0.0.1:3000",
  );
  assert.equal(options.route, "/?scenario=4");
  assert.match(
    options.name,
    /^s4-insights-facilityrow-has-text-solar-[a-f0-9]{12}$/,
  );
  assert.deepEqual(
    options.viewports.map(({ label }) => label),
    ["1280", "390", "360x700"],
  );
  assert.deepEqual(options.viewports[2], {
    width: 360,
    height: 700,
    label: "360x700",
  });
  assert.deepEqual(options.themes, ["dark", "light"]);
  assert.equal(options.clip, ".facilityRow:has-text('Solar')");
  assert.equal(options.outDir, path.join(cwd, "elsewhere"));
  assert.equal(options.delay, 0);
  assert.equal(options.baseUrl, "http://127.0.0.1:3000");
});

test("a bare route is photographed as is; naming a view starts the game from it", () => {
  const plain = parse("--url", "/manual?page=2", "--full-page");
  assert.equal(plain.route, "/manual?page=2");
  assert.equal(plain.game, false);
  assert.equal(plain.fullPage, true);
  assert.match(plain.name, /^url-manual-page-2-[a-f0-9]{12}-full$/);
  const started = parse("--url", "/?scenario=9", "--view", "build");
  assert.equal(started.game, true);
  assert.equal(started.view, "build");
  assert.match(started.name, /^url-scenario-9-[a-f0-9]{12}-build$/);
  assert.equal(parse("--name", "Before fix!").name, "before-fix");
});

test("captures of one view get different file names unless a name is given", () => {
  // Reviewers share one checkout and one output directory: a second clip or a full-page
  // capture of the same scenario and view must not replace the first one's file.
  const names = [
    parse().name,
    parse("--clip", ".facilityRow:has-text('Solar')").name,
    parse("--clip", ".facilityRow:has-text('Wind')").name,
    parse("--full-page").name,
  ];
  assert.deepEqual(
    names.map((name) => name.replace(/-[a-f0-9]{12}$/, "")),
    [
      "s108-facilities",
      "s108-facilities-facilityrow-has-text-solar",
      "s108-facilities-facilityrow-has-text-wind",
      "s108-facilities-full",
    ],
  );
  assert.equal(parse("--clip", ".x", "--name", "before").name, "before");
});

test("default names distinguish selectors and routes with the same readable slug", () => {
  for (const [option, first, second] of [
    [
      "--clip",
      ".facilityRow:has-text('Natural Gas Combined Cycle'):nth(0)",
      ".facilityRow:has-text('Natural Gas Combined Cycle'):nth(1)",
    ],
    ["--clip", ".facilityRow > .name", ".facilityRow + .name"],
    ["--url", "/manual?a=1", "/manual/a/1"],
  ]) {
    assert.notEqual(parse(option, first).name, parse(option, second).name);
    assert.equal(parse(option, first).name, parse(option, first).name);
  }
});

test("help short-circuits validation", () => {
  assert.deepEqual(parse("--help"), { help: true });
});

test("mistakes name the option and are usage errors", () => {
  const rejected = [
    [["--view", "nowhere"], /--view must be one of/],
    [["--scenario", "abc"], /--scenario must be a whole number/],
    [["--viewports", "wide"], /--viewports entry "wide"/],
    [["--viewports", "100"], /--viewports width must be a whole number/],
    [["--theme", "sepia"], /--theme has unknown value "sepia"/],
    [["--clip", "x", "--full-page"], /cannot be combined/],
    [["--scenario", "1", "--url", "/"], /either --scenario or --url/],
    [["--url", "manual"], /--url must be a route/],
    [["--url", "//example.com"], /--url must be a route/],
    [["--url", "//electrify.invalid"], /--url must be a route/],
    [["--url", "/\\example.com"], /--url must be a route/],
    [["--url", "/\t/example.com"], /--url must be a route/],
    [["--url", "///"], /--url must be a route/],
    [["--clip"], /--clip needs a value/],
    [["--clip", "--full-page"], /--clip needs a value/],
    [["--full-page=yes"], /does not take a value/],
    [["--delay", "-5"], /--delay must be a whole number/],
    [["--wide"], /unknown option --wide/],
    [["loose"], /unexpected argument "loose"/],
  ];
  for (const [argv, message] of rejected)
    assert.throws(
      () => parse(...argv),
      (error) => error instanceof UsageError && message.test(error.message),
      argv.join(" "),
    );
});

async function withServer(run) {
  const server = http.createServer((_request, response) => response.end("ok"));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await run(server.address().port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function lease(directory, port, owner) {
  const folder = path.join(directory, `port-${port}`);
  fs.mkdirSync(folder, { recursive: true });
  const token = `token${port}`;
  fs.writeFileSync(
    path.join(folder, `${token}.json`),
    JSON.stringify({
      token,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      ...owner,
    }),
  );
}

test("an explicit URL wins, and an unreachable one is reported", async () => {
  await withServer(async (port) => {
    const url = `http://127.0.0.1:${port}`;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shot-explicit-"));
    const none = path.join(root, "none");
    const resolved = await resolveBaseUrl({
      flag: `${url}/`,
      env: { E2E_BASE_URL: "http://127.0.0.1:1" },
      root,
      coordinationDir: none,
    });
    assert.deepEqual(resolved, { url, source: "--base-url" });
    assert.equal(
      (
        await resolveBaseUrl({
          env: { E2E_BASE_URL: url, BASE_URL: "http://127.0.0.1:1" },
          root,
          coordinationDir: none,
        })
      ).source,
      "E2E_BASE_URL",
    );
    assert.equal(
      (
        await resolveBaseUrl({
          env: { BASE_URL: url },
          root,
          coordinationDir: none,
        })
      ).source,
      "BASE_URL",
    );
    await assert.rejects(
      resolveBaseUrl({
        env: { E2E_BASE_URL: "http://127.0.0.1:1" },
        root,
        coordinationDir: none,
        probe: async () => false,
      }),
      /cannot reach http:\/\/127\.0\.0\.1:1 \(from E2E_BASE_URL\)/,
    );
  });
});

test("an empty explicit base URL cannot fall back to another app", async () => {
  await assert.rejects(
    resolveBaseUrl({
      flag: "",
      env: { E2E_BASE_URL: "http://127.0.0.1:1234" },
      probe: async () => true,
    }),
    /--base-url is not a URL/,
  );
});

test("base URLs under a subpath are rejected before probing", async () => {
  for (const base of [
    { flag: "https://example.com/app" },
    { env: { E2E_BASE_URL: "https://example.com/app/" } },
    { env: { BASE_URL: "https://example.com/app/nested" } },
  ]) {
    let probed = false;
    await assert.rejects(
      resolveBaseUrl({
        env: {},
        ...base,
        probe: async () => {
          probed = true;
          return true;
        },
      }),
      /must use the origin root without a subpath/,
    );
    assert.equal(probed, false);
  }
});

test("only a live server reserved by this checkout is found automatically", async () => {
  await withServer(async (port) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shot-root-"));
    const coordinationDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "shot-lease-"),
    );
    const options = { env: {}, root, coordinationDir };
    // No reservations at all: say how to start one rather than guessing a port.
    await assert.rejects(resolveBaseUrl(options), /npm start/);

    // Another checkout's server on a live port is never used.
    lease(coordinationDir, port, { cwd: path.join(root, "other") });
    await assert.rejects(resolveBaseUrl(options), /no running app found/);

    // A dead owner's leftover reservation is ignored too.
    fs.rmSync(path.join(coordinationDir, `port-${port}`), { recursive: true });
    lease(coordinationDir, port, { cwd: root, pid: 2 ** 22 + 12345 });
    await assert.rejects(resolveBaseUrl(options), /no running app found/);

    // A live reservation here that nothing listens on is skipped; the next one is used.
    fs.rmSync(path.join(coordinationDir, `port-${port}`), { recursive: true });
    lease(coordinationDir, 1, { cwd: root });
    lease(coordinationDir, port, { cwd: root, startedAt: "2000-01-01" });
    assert.deepEqual(await resolveBaseUrl(options), {
      url: `http://127.0.0.1:${port}`,
      source: "this checkout's running server",
    });
  });
});

function shotCommand(...args) {
  return spawnSync(
    process.execPath,
    [path.resolve("scripts/dev/shot.js"), ...args],
    { encoding: "utf8", windowsHide: true },
  );
}

test("usage is printed on request, and mistakes exit with 2 before any browser starts", () => {
  const help = shotCommand("--help");
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--clip <selector>/);
  const mistake = shotCommand("--view", "nowhere");
  assert.equal(mistake.status, 2);
  assert.match(mistake.stderr, /--view must be one of[\s\S]*--help/);
});

function listTests(config, filter, env = {}) {
  const result = spawnSync(
    process.execPath,
    [
      require.resolve("@playwright/test/cli"),
      "test",
      `--config=e2e/${config}`,
      "--list",
      "--reporter=json",
      filter,
    ],
    {
      encoding: "utf8",
      maxBuffer: 20e6,
      windowsHide: true,
      // This checks discovery, not renderer artifacts. Hosted CPU jobs have no desktop build;
      // runtime browser commands keep their normal production-bundle verification.
      env: {
        ...process.env,
        GITHUB_ACTIONS: "false",
        MULTIPLAYER_BUILD_DIR: "",
        STEAM_INPUT_BUILD_DIR: "",
        ELECTRIFY_SHOT: "",
        ...env,
      },
    },
  );
  assert.ifError(result.error);
  assert.ok(result.stdout.trim(), `${config}: ${result.stderr}`);
  return { status: result.status, ...JSON.parse(result.stdout) };
}

test("the runner config makes one capture per viewport and theme, named like the files", () => {
  const request = {
    ...parse("--viewports", "1280,390,500x600", "--theme", "light,dark"),
    baseURL: "http://127.0.0.1:1",
  };
  const listing = listTests("shot.playwright.config.ts", "shot\\.run", {
    ELECTRIFY_SHOT: JSON.stringify(request),
  });
  assert.equal(listing.status, 0);
  assert.deepEqual(
    listing.suites.flatMap((suite) =>
      suite.specs.flatMap((spec) => spec.tests.map((t) => t.projectName)),
    ),
    ["1280", "390", "500x600"].flatMap((viewport) =>
      ["light", "dark"].map((theme) => `${viewport}-${theme}`),
    ),
  );
  assert.deepEqual(
    [...new Set(listing.suites.map((suite) => suite.file))],
    ["shot.run.ts"],
  );
});

test("the screenshot runner is never part of an ordinary browser suite", () => {
  // It is not a *.spec.ts, so no suite selects it. If one did, it would run in every project
  // without a request to read and fail the pull request matrix.
  for (const config of [
    "playwright.config.ts",
    "ci.playwright.config.ts",
    "production.playwright.config.ts",
    "desktop.playwright.config.ts",
    "multiplayer.playwright.config.ts",
    "steam-input.playwright.config.ts",
  ]) {
    const listing = listTests(config, "shot\\.run");
    assert.equal(listing.status, 1, config);
    assert.deepEqual(listing.suites, [], config);
    assert.match(listing.errors[0].message, /No tests found/, config);
  }
});
