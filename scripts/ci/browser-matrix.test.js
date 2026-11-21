const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const { parse } = require("yaml");
const { planForRun } = require("./test-suites");

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
      "contextual-learning.spec.ts",
      "manual-help-interaction.spec.ts",
      "escape-close.spec.ts",
      "game-workspace.spec.ts",
      "insights-policy-projection.spec.ts",
      "mission-evidence.spec.ts",
      "tutorial-exit.spec.ts",
      "cloud-saves.spec.ts",
      "menu-keyboard.spec.ts",
      "music.spec.ts",
      "music-startup.spec.ts",
      "pwa-sound.spec.ts",
      "achievements.spec.ts",
      "browser-environment.spec.ts",
      "loading-navigation.spec.ts",
      "facilities-production-chart.spec.ts",
      "production-chart-motion.spec.ts",
      "intertie-order.spec.ts",
      "facility-selection.spec.ts",
      "operations-priorities.spec.ts",
      "offline-launch.spec.ts",
      ...projects,
    ]),
    ...list([
      "--config=e2e/playwright.config.ts",
      "build-rail.spec.ts",
      "grid-status.spec.ts",
      "project-build.spec.ts",
      "cities-capacity.spec.ts",
      "map-3d.spec.ts",
      "chart-touch.spec.ts",
      "chernobyl-recovery.spec.ts",
      "insights-expanded-chart.spec.ts",
      "insights-shortfall.spec.ts",
      "build-generator-loading.spec.ts",
      "sign-in.spec.ts",
      "multiline-text.spec.ts",
      "learning-pages.spec.ts",
      "scenario-pages.spec.ts",
      "ui-chart-build-polish.spec.ts",
      "modal-layout.spec.ts",
      "wildfire-scenario.spec.ts",
      "acquisitions.spec.ts",
      "tutorial-capstone.spec.ts",
      "campaign.spec.ts",
      "difficulty-unlocks.spec.ts",
      "toggle-borders.spec.ts",
      ...projects,
      "--project=mobile-360px",
    ]),
    ...list([
      "--config=e2e/playwright.config.ts",
      "tutorial-actions.spec.ts",
      "main-menu.spec.ts",
      "home-entry.spec.ts",
      "home-motion.spec.ts",
      ...projects,
      "--project=mobile-360px",
    ]),
  ].sort();
  const { shard: shards } = parse(
    fs.readFileSync(".github/workflows/workflow.yml", "utf8"),
  ).jobs.browser.strategy.matrix;
  const actual = shards
    .flatMap((shard) => {
      const plan = planForRun("browser", {
        ELECTRIFY_BROWSER_SHARD: `${shard}/${shards.length}`,
      });
      const cases = list([
        "--config=e2e/ci.playwright.config.ts",
        ...plan.browser[0].args,
      ]);
      assert(cases.length > 0, `Hosted shard ${shard} collected no tests`);
      return cases;
    })
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
