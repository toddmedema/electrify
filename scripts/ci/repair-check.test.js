const assert = require("node:assert/strict");
const test = require("node:test");
const {
  parseRepairArguments,
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
    /matching case/,
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
