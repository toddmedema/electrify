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

function assertProjects(cases, title, expected) {
  const projects = new Set(
    cases
      .filter((entry) => entry.includes(title))
      .map((entry) => entry.split(":")[0]),
  );
  assert.deepEqual([...projects].sort(), [...expected].sort(), title);
}

test("production browser shards run the complete PR matrix exactly once", () => {
  const config = "--config=e2e/ci.playwright.config.ts";
  const original = list([config]).sort();
  const { shard: shards } = parse(
    fs.readFileSync(".github/workflows/workflow.yml", "utf8"),
  ).jobs.browser.strategy.matrix;
  const actual = shards
    .flatMap((shard) => {
      const plan = planForRun("browser", {
        ELECTRIFY_BROWSER_SHARD: `${shard}/${shards.length}`,
      });
      const cases = list([config, ...plan.browser[0].args]);
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

test("viewport routing keeps shared behavior and distinct browser contracts", () => {
  const desktop = "desktop-chromium";
  const phone = "mobile-390px";
  const minimum = "mobile-360px";
  const cases = list(["--config=e2e/ci.playwright.config.ts"]);

  assertProjects(cases, "first year and resumes from IndexedDB", [desktop]);
  assertProjects(cases, "locked generator survives resume", [desktop, phone]);
  assertProjects(cases, "capacity review actions remain reachable", [
    desktop,
    minimum,
  ]);
  assertProjects(cases, "a live resize switches tablet, foldable and desktop", [
    desktop,
  ]);
  assertProjects(
    cases,
    "interties support keyboard and pointer trading reordering",
    [desktop, phone],
  );
  assertProjects(cases, "/data-centers.html remains readable and navigable", [
    desktop,
    minimum,
  ]);

  for (const { slug } of require("../../site/scenarios.json"))
    assert(
      cases.some(
        (entry) =>
          entry.startsWith(`${desktop}:`) &&
          entry.includes(`:${slug} is readable in light mode`),
      ),
      `missing authored scenario page: ${slug}`,
    );

  const local = list(["--config=e2e/playwright.config.ts"]);
  assertProjects(
    local,
    "short panes keep the fleet and trading controls reachable",
    [desktop, "foldable-unfolded"],
  );
  assertProjects(local, "insights header controls stay aligned", [
    desktop,
    phone,
    minimum,
    "tablet-768px",
  ]);
  assertProjects(local, "settings fill the shared menu container", [
    desktop,
    phone,
    minimum,
    "desktop-1440px",
  ]);
});

test("controller routing keeps the full journey and focused display checks", () => {
  const cases = list(["--config=e2e/steam-input.playwright.config.ts"]);
  assertProjects(
    cases,
    "semantic actions play, build, adjust pricing, inspect charts and save",
    ["deck-800-light"],
  );
  assertProjects(
    cases,
    "controller changes interface scale, keeps settings reachable",
    ["deck-800-light", "deck-720-light", "deck-720-dark", "mobile-360px"],
  );
  assertProjects(cases, "controller hints follow the active device", [
    "deck-800-light",
    "mobile-390px",
  ]);
  assertProjects(cases, "menu movement under a stationary pointer", [
    "deck-800-light",
    "docked-light",
  ]);
  assertProjects(cases, "TV maximum interface scale and screen-edge padding", [
    "deck-800-light",
    "tv-1080-light",
    "tv-1080-dark",
    "tv-2160-light",
    "tv-2160-dark",
  ]);
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
