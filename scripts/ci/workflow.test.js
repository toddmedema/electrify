const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const { parse } = require("yaml");
const { commands, cpuSuites, execute } = require("./platform-tests");
const { names } = require("./wait-native");
const { partition } = require("./jest-filter");

test("PR CI has exactly six jobs including all native targets and the required coverage gate", () => {
  const { jobs } = parse(
    fs.readFileSync(".github/workflows/workflow.yml", "utf8"),
  );
  assert.deepEqual(Object.keys(jobs).sort(), ["build", "check", "platform"]);
  assert.deepEqual(Object.keys(jobs.platform.strategy.matrix), ["include"]);
  const workers = jobs.platform.strategy.matrix.include;
  assert.equal(workers.length + 2, 6);
  assert.deepEqual(
    workers.map(({ platform, arch }) => `${platform}-${arch}`).sort(),
    ["darwin-arm64", "darwin-x64", "linux-x64", "win32-x64"],
  );
  assert.deepEqual(workers.map(({ index }) => index).sort(), [1, 2, 3, 4]);
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
    fs.readFileSync("e2e/ci.playwright.config.ts", "utf8"),
    /test-results\/browser/,
  );
});

test("platform plans retain all CPU shards, browser shards and full native suites", () => {
  for (let index = 1; index <= 4; index++) {
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
  "CPU suites overlap, UI stays serial, and failures never skip the other tests",
  { timeout: 1000 },
  async () => {
    const seen = [];
    const started = new Set();
    let release;
    const bothCpuStarted = new Promise((resolve) => {
      release = resolve;
    });
    const result = await execute(
      {
        cpu: [{ name: "check" }, { group: "unit" }, { group: "simulation" }],
        ui: [{ name: "package" }, { name: "browser" }, { name: "native" }],
      },
      async (step) => {
        seen.push(step.name || step.group);
        if (step.group) {
          started.add(step.group);
          if (started.size === 2) release();
          await bothCpuStarted;
        }
        return step.name !== "check" && step.group !== "unit";
      },
    );
    assert.equal(result.length, 6);
    assert.equal(result.filter((passed) => !passed).length, 2);
    assert.deepEqual([...started].sort(), ["simulation", "unit"]);
    assert(seen.indexOf("check") < seen.indexOf("unit"));
    assert.deepEqual(
      seen.filter((name) => ["package", "browser", "native"].includes(name)),
      ["package", "browser", "native"],
    );
  },
);

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
