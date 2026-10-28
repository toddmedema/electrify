const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");

function list(arguments_) {
  const result = spawnSync(
    process.execPath,
    [
      require.resolve("@playwright/test/cli"),
      "test",
      ...arguments_,
      "--list",
      "--reporter=json",
    ],
    { encoding: "utf8", maxBuffer: 20e6 },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const cases = [];
  function walk(suites, titles = []) {
    for (const suite of suites) {
      const parents = [...titles, suite.title];
      for (const spec of suite.specs || [])
        for (const project of spec.tests)
          cases.push(
            `${project.projectName}:${spec.file}:${spec.line}:${parents.join("/")}:${spec.title}`,
          );
      walk(suite.suites || [], parents);
    }
  }
  walk(JSON.parse(result.stdout).suites);
  return cases;
}

test("production browser shards run the complete PR matrix exactly once", () => {
  const projects = ["--project=desktop-chromium", "--project=mobile-390px"];
  const original = [
    ...list([
      "--config=e2e/playwright.config.ts",
      "build-options.spec.ts",
      "escape-close.spec.ts",
      "game-workspace.spec.ts",
      "mission-evidence.spec.ts",
      "tutorial-exit.spec.ts",
      "cloud-saves.spec.ts",
      "menu-keyboard.spec.ts",
      "music.spec.ts",
      "achievements.spec.ts",
      "browser-environment.spec.ts",
      "loading-navigation.spec.ts",
      "facilities-production-chart.spec.ts",
      "production-chart-motion.spec.ts",
      "intertie-order.spec.ts",
      "operations-priorities.spec.ts",
      ...projects,
    ]),
    ...list([
      "--config=e2e/playwright.config.ts",
      "multiline-text.spec.ts",
      "learning-pages.spec.ts",
      "ui-chart-build-polish.spec.ts",
      "modal-layout.spec.ts",
      "wildfire-scenario.spec.ts",
      ...projects,
      "--project=mobile-360px",
    ]),
    ...list([
      "--config=e2e/playwright.config.ts",
      "tutorial-actions.spec.ts",
      "main-menu.spec.ts",
      ...projects,
      "--project=mobile-360px",
    ]),
  ].sort();
  const actual = [1, 2]
    .flatMap((shard) =>
      list(["--config=e2e/ci.playwright.config.ts", `--shard=${shard}/2`]),
    )
    .sort();
  assert(original.length > 0);
  assert.equal(
    new Set(actual).size,
    actual.length,
    "A browser case ran in multiple shards",
  );
  assert.deepEqual(actual, original);
});

test("native sharding preserves every packaged desktop case with one worker per isolated runner", (t) => {
  const fs = require("node:fs");
  const path = require("node:path");
  const { discover, plan } = require("./desktop-tests");
  const parent = path.resolve(".tmp", "native-plan-tests");
  fs.mkdirSync(parent, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(parent, "plan-"));
  t.after(() => {
    assert(temporary.startsWith(parent + path.sep));
    fs.rmSync(temporary, { recursive: true, force: true });
  });
  const config = "--config=e2e/desktop.playwright.config.ts";
  assert(list([config]).length > 0);
  const original = discover();
  const actual = [1, 2]
    .flatMap((shard) =>
      discover(plan(shard, 2, path.join(temporary, String(shard)))),
    )
    .sort();
  assert(original.length > 0);
  assert.equal(new Set(actual).size, actual.length);
  assert.deepEqual(actual, original);
});
