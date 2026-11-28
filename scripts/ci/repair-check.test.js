const assert = require("node:assert/strict");
const test = require("node:test");
const { configuredStep, steps } = require("../check");
const {
  browserEnvironment,
  browserSelection,
  grepPattern,
  parseRepairArguments,
  buildDirectories,
  requireCase,
  requireFirstAttemptPass,
} = require("./repair-check");

const wanted = {
  runner: "web",
  file: "e2e/regional-map.spec.ts",
  project: "mobile-390px",
  title: "a new custom grid starts on the 3D map for the selected city",
};

function report({
  title = wanted.title,
  projectName = wanted.project,
  status = "expected",
  expectedStatus = "passed",
  results = [{ retry: 0, status: "passed" }],
} = {}) {
  return {
    suites: [
      {
        specs: [],
        suites: [
          {
            specs: [
              {
                file: "regional-map.spec.ts",
                title,
                tests: [{ projectName, status, expectedStatus, results }],
              },
            ],
          },
        ],
      },
    ],
  };
}

test("a repair requires an explicit target base and an affected check", () => {
  assert.throws(
    () => parseRepairArguments(["--suite", "src/Store.test.ts"]),
    /Usage/,
  );
  assert.throws(
    () => parseRepairArguments(["--base", "origin/master"]),
    /Usage/,
  );
  assert.throws(
    () => parseRepairArguments(["--base", "origin/master", "--simulation"]),
    /--simulation only adds/,
  );
  assert.throws(
    () =>
      parseRepairArguments([
        "--base",
        "origin/master",
        "--suite",
        "src/../scripts/ci/repair-check.test.js",
      ]),
    /under src/,
  );
  assert.throws(
    () => parseRepairArguments(["--base", "origin/master", "--gate", "green"]),
    /Unknown check step/,
  );
  assert.throws(
    () =>
      parseRepairArguments([
        "--base",
        "origin/master",
        "--case",
        "native:electron:e2e/desktop.spec.ts:Start",
      ]),
    /Invalid browser case/,
  );
});

test("browser repairs select the required renderer builds alongside static gates", () => {
  const parsed = parseRepairArguments([
    "--base",
    "origin/codex/3d-only-workspace",
    "--case",
    `web:${wanted.project}:${wanted.file}:${wanted.title}`,
    "--case",
    "controller:deck-800-light:e2e/steam-input.spec.ts:Deck: opens Fleet",
    "--case",
    "crossplay:desktop-chromium:e2e/crossplay.spec.ts:simulated relay lets Steam host cross-play",
    "--suite",
    "src/desktop/Input.test.tsx",
    "--resume",
  ]);
  assert.deepEqual(parsed.gates, [
    "types",
    "lint",
    "formatting",
    "build",
    "desktop-build",
  ]);
  assert.deepEqual(parsed.cases[0], wanted);
  assert.equal(parsed.cases[1].title, "Deck: opens Fleet");
  assert.deepEqual(parsed.suite, ["src/desktop/Input.test.tsx"]);
});

test("discovery rejects the wrong title, wrong viewport, no tests and an ambiguous selection", () => {
  assert.doesNotThrow(() => requireCase(report({ results: [] }), wanted));
  assert.throws(
    () => requireCase(report({ title: "opens the map" }), wanted),
    /selected 1: mobile-390px \/ e2e\/regional-map\.spec\.ts \/ opens the map/,
  );
  assert.throws(
    () => requireCase(report({ projectName: "desktop-chromium" }), wanted),
    /matching case/,
  );
  assert.throws(() => requireCase({ suites: [] }, wanted), /selected 0/);
  const one = report();
  assert.throws(
    () => requireCase({ suites: [...one.suites, ...one.suites] }, wanted),
    /selected 2/,
  );
});

test("focused cases serve the renderer directories check:ci just built", () => {
  const step = (id, hosted) =>
    configuredStep(
      steps.find((entry) => entry.id === id),
      hosted,
    );
  for (const hosted of [false, true]) {
    const builds = buildDirectories(hosted);
    assert.equal(builds.web, step("build", hosted).env?.BUILD_PATH || "build");
    assert.equal(
      builds.desktop,
      step("desktop-build", hosted).env?.BUILD_PATH || "build",
    );
    const web = browserEnvironment("web", hosted);
    assert.equal(web.CI, "true");
    assert.equal(web.E2E_BASE_URL, "");
    assert.equal(web.ELECTRIFY_E2E_ALL_SPECS, "");
    assert.equal(
      web.E2E_BUILD_DIR,
      step("browser", hosted).env?.E2E_BUILD_DIR || builds.web,
    );
    assert.equal(
      browserEnvironment("controller", hosted).STEAM_INPUT_BUILD_DIR,
      step("steam-input", hosted).env.STEAM_INPUT_BUILD_DIR,
    );
    assert.equal(
      browserEnvironment("multiplayer", hosted).MULTIPLAYER_BUILD_DIR,
      step("multiplayer", hosted).env.MULTIPLAYER_BUILD_DIR,
    );
    const all = browserEnvironment("web-all", hosted);
    assert.equal(all.CI, "true");
    assert.equal(all.ELECTRIFY_E2E_ALL_SPECS, "1");
    assert.equal(all.E2E_BUILD_DIR, builds.web);
    assert.equal(
      browserEnvironment("crossplay", hosted).CROSSPLAY_BUILD_DIR,
      builds.desktop,
    );
    assert.equal(
      browserEnvironment("crossplay", hosted).CROSSPLAY_WEB_ONLY,
      "",
    );
    assert.equal(
      browserEnvironment("crossplay-web", hosted).CROSSPLAY_BUILD_DIR,
      builds.web,
    );
    assert.equal(
      browserEnvironment("crossplay-web", hosted).CROSSPLAY_WEB_ONLY,
      "1",
    );
  }
  assert.deepEqual(buildDirectories(false), {
    web: ".tmp/check-builds/web",
    desktop: ".tmp/check-builds/desktop",
  });
  assert.deepEqual(buildDirectories(true), {
    web: "build",
    desktop: "build",
  });
});

test("browser selection is one file and the exact leaf title", () => {
  const [filePattern, project, grep] = browserSelection(wanted);
  const file = new RegExp(filePattern, "i");
  assert.equal(project, `--project=${wanted.project}`);
  assert.match("/repo/e2e/regional-map.spec.ts", file);
  assert.doesNotMatch("/repo/note2e/regional-map.spec.ts", file);
  assert.doesNotMatch("/repo/e2e/regional-map.spec.ts.snap", file);

  const title =
    "semantic actions play, build, adjust pricing, inspect charts and save at 125% interface scale";
  const exact = new RegExp(grepPattern(title), "i");
  assert.equal(grep, `--grep=${grepPattern(wanted.title)}`);
  assert.match(`deck-800-light steam-input.spec.ts ${title}`, exact);
  assert.match(`file.spec.ts Describe ${title} @controller`, exact);
  assert.doesNotMatch(`file.spec.ts ${title} extra`, exact);
  assert.doesNotMatch("file.spec.ts save", exact);

  const shorter = new RegExp(grepPattern("save"), "i");
  assert.match("file.spec.ts save", shorter);
  assert.match("file.spec.ts save @mobile", shorter);
  assert.doesNotMatch("file.spec.ts save the game", shorter);
  const grouped = new RegExp(grepPattern("Close (button)"), "i");
  assert.match("file.spec.ts Close (button)", grouped);
  assert.doesNotMatch("file.spec.ts Close button", grouped);
});

test("browser evidence requires an actual first-attempt pass of the requested case", () => {
  assert.doesNotThrow(() => requireFirstAttemptPass(report(), wanted));
  for (const outcome of [
    { status: "skipped", results: [] },
    { status: "skipped", results: [{ retry: 0, status: "skipped" }] },
    { status: "unexpected", results: [{ retry: 0, status: "timedOut" }] },
    { expectedStatus: "failed", results: [{ retry: 0, status: "failed" }] },
    {
      status: "flaky",
      results: [
        { retry: 0, status: "failed" },
        { retry: 1, status: "passed" },
      ],
    },
  ]) {
    assert.throws(
      () => requireFirstAttemptPass(report(outcome), wanted),
      /did not pass on its first attempt/,
    );
  }
});
