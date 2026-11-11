const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
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
    pause: true,
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
    "--no-pause",
    "--base-url",
    "http://127.0.0.1:3000",
  );
  assert.equal(options.route, "/?scenario=4");
  assert.equal(options.name, "s4-insights");
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
  assert.equal(options.pause, false);
  assert.equal(options.baseUrl, "http://127.0.0.1:3000");
});

test("a bare route is photographed as is; naming a view starts the game from it", () => {
  const plain = parse("--url", "/manual?page=2", "--full-page");
  assert.equal(plain.route, "/manual?page=2");
  assert.equal(plain.game, false);
  assert.equal(plain.fullPage, true);
  assert.equal(plain.name, "url-manual-page-2");
  const started = parse("--url", "/?scenario=9", "--view", "build");
  assert.equal(started.game, true);
  assert.equal(started.view, "build");
  assert.equal(started.name, "url-scenario-9-build");
  assert.equal(parse("--name", "Before fix!").name, "before-fix");
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
