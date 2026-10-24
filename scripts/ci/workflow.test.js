const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const { parse } = require("yaml");
const {
  commands,
  cpuSuites,
  execute,
  planForRun,
} = require("./platform-tests");
const { names } = require("./wait-native");
const { partition } = require("./jest-filter");

test("PR CI has exactly five jobs including all native targets and the required coverage gate", () => {
  const { jobs } = parse(
    fs.readFileSync(".github/workflows/workflow.yml", "utf8"),
  );
  assert.deepEqual(Object.keys(jobs).sort(), ["build", "check", "platform"]);
  assert.deepEqual(Object.keys(jobs.platform.strategy.matrix), ["include"]);
  const workers = jobs.platform.strategy.matrix.include;
  assert.equal(workers.length + 2, 5);
  assert.deepEqual(workers.map(({ depot }) => depot).sort(), [
    "darwin-universal",
    "linux-x64",
    "win32-x64",
  ]);
  // The universal Mac app is packaged on Apple Silicon, so its host guard expects arm64.
  assert.equal(
    workers.find(({ platform }) => platform === "darwin").arch,
    "arm64",
  );
  assert.deepEqual(workers.map(({ index }) => index).sort(), [1, 2, 3]);
  assert.deepEqual(jobs.check.needs, ["build"]);
  assert.deepEqual(
    workers.map(({ label }) => `${label} tests`).sort(),
    [...names].sort(),
  );
  assert(
    jobs.check.steps.some(
      ({ run }) => run === "node scripts/ci/wait-native.js",
    ),
  );
  const browserInstalls = jobs.platform.steps.filter(
    ({ name }) =>
      name?.startsWith("Install ") && name.includes("headless browser"),
  );
  assert.equal(browserInstalls.length, 1);
  assert(browserInstalls.every(({ run }) => run.includes("--only-shell")));
  assert(
    browserInstalls.find(({ name }) => name.includes("Windows")).run ===
      "npx playwright install --only-shell chromium",
  );
  assert(
    jobs.check.steps.some(
      ({ run }) => run === "node scripts/ci/coverage.js test-results 2",
    ),
  );
  assert.equal(
    jobs.check.steps.find(({ run }) => run === "npm run test:ci-core").if,
    "!cancelled() && needs.build.result == 'success'",
    "A benchmark failure must not skip unit and simulation coverage",
  );
  const native = fs.readFileSync("e2e/desktop.playwright.config.ts", "utf8");
  assert.match(native, /workers: 1/);
  assert.match(native, /test-results\/desktop/);
  assert.match(
    fs.readFileSync("e2e/production.playwright.config.ts", "utf8"),
    /test-results\/browser/,
  );
});

test("platform plans retain all CPU shards, browser shards and full native suites", () => {
  for (let index = 1; index <= 3; index++) {
    const plan = commands(index, 4);
    assert.deepEqual(
      plan.cpu.filter(({ group }) => group).map(({ script }) => script),
      index === 1 ? ["test:ci", "test:sim"] : [],
    );
    assert(
      plan.cpu
        .filter(({ group }) => group)
        .every(({ args }) =>
          args.includes("--filter=./scripts/ci/jest-filter.js"),
        ),
    );
    assert(
      plan.cpu
        .filter(({ group }) => group)
        .every(({ args }) => args.includes("--maxWorkers=2")),
    );
    assert.deepEqual(plan.ui.at(-1), {
      name: "Full packaged desktop",
      script: "test:desktop",
      args: ["--headed"],
    });
    assert.equal(plan.ui[0].script, "desktop:pack:offline");
    assert(plan.ui[0].args.includes("--skip-build"));
    const browser = plan.ui.find(({ script }) => script === "test:e2e:ci");
    assert.equal(!!browser, index === 2 || index === 3);
    if (browser) {
      assert(browser.args.includes(`--shard=${index - 1}/2`));
      assert(browser.args.includes("--workers=2"));
    }
    assert.equal(
      plan.ui.some(({ script }) => script === "test:multiplayer"),
      index === 3,
      "Headless multiplayer renderer tests run once on the full-dependency Mac browser worker",
    );
    assert.equal(
      plan.ui.some(({ script }) => script === "test:steam-input"),
      index === 2,
      "Controller journeys use the less-loaded Windows worker without adding jobs or overlapping heavy phases",
    );
    if (index === 2)
      assert.deepEqual(
        plan.ui.find(({ script }) => script === "test:steam-input").env,
        { STEAM_INPUT_BUILD_DIR: "build" },
      );
  }
  assert.deepEqual(
    cpuSuites(2, 4).map(({ script }) => script),
    ["test:ci", "test:sim"],
  );
  const result = spawnSync(
    process.execPath,
    ["scripts/ci/platform-tests.js", "1"],
    { env: { ...process.env, GITHUB_ACTIONS: "false" }, encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /only for GitHub Actions/);
});

test(
  "heavy CPU and UI phases never overlap, and failures never skip the other tests",
  { timeout: 1000 },
  async () => {
    const seen = [];
    let activeHeavy = 0;
    let peakHeavy = 0;
    const result = await execute(
      {
        cpu: [{ name: "check" }, { group: "unit" }, { group: "simulation" }],
        ui: [{ name: "package" }, { name: "browser" }, { name: "native" }],
      },
      async (step) => {
        seen.push(step.name || step.group);
        const heavy = step.group || step.name !== "check";
        if (heavy) {
          activeHeavy++;
          peakHeavy = Math.max(peakHeavy, activeHeavy);
        }
        await new Promise(setImmediate);
        if (heavy) activeHeavy--;
        return step.name !== "check" && step.group !== "unit";
      },
    );
    assert.equal(result.length, 6);
    assert.equal(result.filter((passed) => !passed).length, 2);
    assert.equal(
      peakHeavy,
      1,
      "one runner must run only one heavy phase at a time",
    );
    assert.equal(activeHeavy, 0);
    assert.deepEqual(seen, [
      "check",
      "unit",
      "simulation",
      "package",
      "browser",
      "native",
    ]);
  },
);

test("CI's CPU shards can be reproduced locally without native windows or excess workers", () => {
  for (const index of [1, 2]) {
    const local = planForRun(index, true, { GITHUB_ACTIONS: "false" }, 20);
    assert.deepEqual(local.ui, []);
    assert.deepEqual(local.cpu, cpuSuites(index, 4));
    assert(local.cpu.every(({ args }) => args.includes("--maxWorkers=2")));
  }
  assert.deepEqual(
    planForRun(1, true, { GITHUB_ACTIONS: "false" }, 2).cpu,
    cpuSuites(1, 2),
  );
  assert.deepEqual(
    planForRun(1, true, { GITHUB_ACTIONS: "true" }, 8).cpu,
    cpuSuites(1, 8),
  );
  assert.throws(() => planForRun(1, false, {}, 4), /only for GitHub Actions/);
  assert.deepEqual(
    planForRun(1, false, { GITHUB_ACTIONS: "true" }, 4),
    commands(1, 4),
  );
});

test("optional capacity balancing stays complete for unequal workers", () => {
  const files = Array.from({ length: 40 }, (_, index) => `test-${index}`);
  const estimates = Object.fromEntries(
    files.map((file, index) => [file, index + 1]),
  );
  const capacities = [1, 1, 1, 0.15];
  const groups = partition(files, 4, estimates, capacities);
  assert.deepEqual(groups.flat().sort(), [...files].sort());
  assert.deepEqual(
    groups,
    partition([...files].reverse(), 4, estimates, capacities),
  );
  const costs = groups.map((group) =>
    group.reduce((sum, file) => sum + estimates[file], 0),
  );
  assert(costs[3] < Math.min(...costs.slice(0, 3)) / 3);
  assert.throws(() => partition(files, 4, estimates, [1, 1]), /capacities/);
  assert.throws(
    () => partition(files, 4, estimates, [1, 1, 1, 0]),
    /capacities/,
  );
});
