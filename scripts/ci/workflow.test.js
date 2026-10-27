const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { parse } = require("yaml");
const { commands, cpuSuites, execute, planForRun } = require("./test-suites");
const { partition } = require("./jest-filter");

const workflow = () =>
  parse(fs.readFileSync(".github/workflows/workflow.yml", "utf8"));

test("PR CI isolates all tests from the three native builds in six jobs", () => {
  const { jobs } = workflow();
  assert.deepEqual(Object.keys(jobs).sort(), [
    "build",
    "check",
    "platform",
    "tests",
  ]);
  assert.deepEqual(Object.keys(jobs.platform.strategy.matrix), ["include"]);
  const workers = jobs.platform.strategy.matrix.include;
  assert.equal(workers.length + 3, 6);
  assert.deepEqual(workers.map(({ depot }) => depot).sort(), [
    "darwin-universal",
    "linux-x64",
    "win32-x64",
  ]);
  assert.equal(
    workers.find(({ platform }) => platform === "darwin").arch,
    "arm64",
  );

  // Neither branch can wait for, or be skipped by a failure in, the other branch.
  assert.equal(jobs.build.needs, undefined);
  assert.equal(jobs.tests.needs, "build");
  assert.equal(jobs.platform.needs, "build");
  assert.equal(jobs.tests["runs-on"], "ubuntu-22.04");
  assert.equal(jobs.platform.strategy["fail-fast"], false);
  assert.equal(
    jobs.platform.steps.find(({ with: options }) => options?.profile).with
      .profile,
    "desktop",
  );

  const platformRuns = jobs.platform.steps.flatMap(({ run }) =>
    run ? [run] : [],
  );
  const npmRuns = platformRuns.filter((run) => run.startsWith("npm "));
  assert.equal(npmRuns.length, 1);
  assert.match(npmRuns[0], /^npm run desktop:pack:offline -- --skip-build /);
  assert(
    !jobs.platform.steps.some(
      ({ uses }) => uses === "./.github/actions/jest-cache",
    ),
  );
  assert(
    !jobs.platform.steps.some(
      ({ with: options }) => options?.name === "web-renderer",
    ),
  );

  assert(
    jobs.tests.steps.some(({ run }) => run?.includes("npm run test:ci-all")),
  );
  assert(jobs.tests.steps.some(({ run }) => run?.includes("xvfb-run")));
  assert(
    jobs.tests.steps.some(
      ({ run }) =>
        run === "npx playwright install --with-deps --only-shell chromium",
    ),
  );
  assert(
    jobs.tests.steps.some(
      ({ uses, with: options }) =>
        uses === "actions/setup-java@v6" && options["java-version"] === "21",
    ),
  );
  assert.deepEqual(
    jobs.tests.steps
      .filter(({ uses }) => uses === "actions/download-artifact@v8")
      .map(({ with: options }) => options.name)
      .sort(),
    ["desktop-renderer", "web-renderer"],
  );
  const reports = jobs.tests.steps.find(
    ({ uses }) => uses === "actions/upload-artifact@v7",
  );
  assert.equal(reports.if, "always()");
  assert.match(reports.with.path, /test-results\//);
  assert.match(reports.with.path, /coverage\//);
});

test("trusted master runs warm all three transform caches without adding jobs", () => {
  const config = workflow();
  assert.deepEqual(config.on.push.branches, ["master"]);
  assert(Object.hasOwn(config.on, "pull_request"));
  assert.equal(
    config.concurrency["cancel-in-progress"],
    `\${{ github.event_name != 'push' }}`,
  );
  assert.deepEqual(
    config.jobs.tests.steps
      .filter(({ uses }) => uses === "./.github/actions/jest-cache")
      .map(({ with: options }) => options.group),
    ["unit", "simulation", "world-advance"],
  );
  const action = parse(
    fs.readFileSync(".github/actions/jest-cache/action.yml", "utf8"),
  );
  assert.equal(
    action.runs.steps[0].with.path,
    `.tmp/jest-\${{ inputs.group }}`,
  );
  assert.match(
    action.runs.steps[0].with.key,
    /hashFiles\('package-lock.json'\)/,
  );
});

test("the required gate rejects every failed, skipped, cancelled or timed-out dependency", () => {
  const { jobs } = workflow();
  assert.equal(jobs.check.if, "always()");
  assert.deepEqual([...jobs.check.needs].sort(), [
    "build",
    "platform",
    "tests",
  ]);
  const gate = jobs.check.steps[0];
  assert.deepEqual(gate.env, {
    BUILD_RESULT: `\${{ needs.build.result }}`,
    PLATFORM_RESULT: `\${{ needs.platform.result }}`,
    TEST_RESULT: `\${{ needs.tests.result }}`,
  });
  const successful = {
    BUILD_RESULT: "success",
    PLATFORM_RESULT: "success",
    TEST_RESULT: "success",
  };
  const run = (results) =>
    spawnSync("bash", ["-e", "-c", gate.run], {
      encoding: "utf8",
      env: { ...process.env, ...results },
    });
  assert.equal(run(successful).status, 0);
  for (const dependency of Object.keys(successful))
    for (const result of ["failure", "skipped", "cancelled", "timed_out", ""]) {
      assert.notEqual(
        run({ ...successful, [dependency]: result }).status,
        0,
        `${dependency}: ${result}`,
      );
    }
});

test("one test plan retains every suite, full browser coverage and all static checks", () => {
  const plan = commands(4);
  assert.deepEqual(
    plan.cpu.map(({ script }) => script),
    [
      "typecheck",
      "lint",
      "format:check",
      "test:desktop:native",
      "test:ci-tools",
      "test:rules",
      "perf:bench",
      "test:ci",
      "test:sim",
      "test:ci-coverage",
      "sim",
    ],
  );
  assert.deepEqual(
    plan.ui.map(({ script }) => script),
    [
      "desktop:pack:offline",
      "test:e2e:ci",
      "test:multiplayer",
      "test:steam-input",
      "test:desktop",
    ],
  );
  for (const suite of cpuSuites(4)) {
    assert(suite.args.includes("--filter=./scripts/ci/jest-filter.js"));
    assert(suite.args.includes("--maxWorkers=4"));
  }
  const { scripts } = require("../../package.json");
  assert.equal(
    scripts["test:ci-coverage"],
    "node scripts/ci/coverage.js test-results 1",
  );
  assert.deepEqual(plan.ui[0].args, [
    "--skip-build",
    "--platform",
    "linux",
    "--arch",
    "x64",
  ]);
  assert.deepEqual(
    plan.ui.find(({ script }) => script === "test:e2e:ci").args,
    ["--workers=2"],
  );
  assert.deepEqual(
    plan.ui.find(({ script }) => script === "test:steam-input").env,
    { STEAM_INPUT_BUILD_DIR: "build" },
  );
  assert.deepEqual(plan.ui.at(-1), {
    name: "Full packaged desktop",
    script: "test:desktop",
    args: ["--headed"],
  });
});

test("heavy phases never overlap, and failures never skip the remaining suites", async () => {
  const plan = commands(4);
  const expected = [...plan.cpu, ...plan.ui];
  const seen = [];
  let active = 0;
  let peak = 0;
  const result = await execute(plan, async (step) => {
    seen.push(step);
    peak = Math.max(peak, ++active);
    await new Promise(setImmediate);
    active--;
    return step !== expected[0] && step.script !== "test:ci";
  });
  assert.equal(peak, 1);
  assert.equal(active, 0);
  assert.deepEqual(seen, expected);
  assert.equal(result.length, expected.length);
  assert.equal(result.filter((passed) => !passed).length, 2);
});

test("the complete CPU plan can be reproduced without native windows or excess workers", () => {
  for (const cores of [2, 4, 20]) {
    const local = planForRun(true, { GITHUB_ACTIONS: "false" }, cores);
    assert.deepEqual(local.ui, []);
    assert.deepEqual(local.cpu, commands(cores).cpu);
    assert(
      local.cpu
        .filter(({ group }) => group)
        .every(({ args }) =>
          args.includes(`--maxWorkers=${Math.min(4, cores)}`),
        ),
    );
  }
  assert.throws(() => planForRun(false, {}, 4), /only for GitHub Actions/);
  const result = spawnSync(process.execPath, ["scripts/ci/test-suites.js"], {
    env: { ...process.env, GITHUB_ACTIONS: "false" },
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /only for GitHub Actions/);
});

test("the real harness runs every CPU phase after a failure and passes only when all succeed", (t) => {
  const parent = path.resolve(".tmp", "test-worker-contract");
  fs.mkdirSync(parent, { recursive: true });
  const directory = fs.mkdtempSync(path.join(parent, "run-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const npm = path.join(directory, "npm.cjs");
  const record = path.join(directory, "commands.jsonl");
  fs.writeFileSync(
    npm,
    `
    const fs = require('node:fs');
    const args = process.argv.slice(2);
    const script = args[args.indexOf('run') + 1];
    fs.appendFileSync(process.env.ELECTRIFY_CI_FIXTURE_RECORD, JSON.stringify({
      script, args, group: process.env.TEST_GROUP, shard: process.env.TEST_SHARD,
    }) + '\\n');
    process.exit(script === process.env.ELECTRIFY_CI_FIXTURE_FAIL ? 1 : 0);
  `,
  );
  for (const failing of ["typecheck", ""]) {
    fs.writeFileSync(record, "");
    const result = spawnSync(
      process.execPath,
      ["scripts/ci/test-suites.js", "--cpu-only"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_ACTIONS: "false",
          npm_execpath: npm,
          ELECTRIFY_CI_FIXTURE_RECORD: record,
          ELECTRIFY_CI_FIXTURE_FAIL: failing,
        },
      },
    );
    assert.equal(result.status, failing ? 1 : 0, result.stderr);
    const actual = fs
      .readFileSync(record, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      actual.map(({ script }) => script),
      commands().cpu.map(({ script }) => script),
    );
    for (const group of ["unit", "simulation"]) {
      const suite = actual.find((step) => step.group === group);
      assert.equal(suite.shard, "1/1");
      assert(suite.args.includes("--ignore-scripts"));
    }
  }
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
