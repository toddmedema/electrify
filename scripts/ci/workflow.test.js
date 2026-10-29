const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { parse } = require("yaml");
const {
  commands,
  cpuSuites,
  execute,
  parseGroup,
  planForRun,
} = require("./test-suites");
const { partition } = require("./jest-filter");

const workflow = () =>
  parse(fs.readFileSync(".github/workflows/workflow.yml", "utf8"));

test("PR CI runs three independent test groups and three native builds in eight jobs", () => {
  const { jobs } = workflow();
  assert.deepEqual(Object.keys(jobs).sort(), [
    "browser",
    "build",
    "check",
    "cpu",
    "desktop",
    "platform",
  ]);
  assert.deepEqual(Object.keys(jobs.platform.strategy.matrix), ["include"]);
  const workers = jobs.platform.strategy.matrix.include;
  assert.equal(workers.length + Object.keys(jobs).length - 1, 8);
  assert.deepEqual(workers.map(({ depot }) => depot).sort(), [
    "darwin-universal",
    "linux-x64",
    "win32-x64",
  ]);
  assert.equal(
    workers.find(({ platform }) => platform === "darwin").arch,
    "arm64",
  );
  assert.equal(jobs.build.needs, undefined);
  assert.equal(jobs.cpu.needs, undefined);
  assert.equal(jobs.platform.needs, "build");
  assert.equal(jobs.platform.strategy["fail-fast"], false);
  assert.equal(
    jobs.platform.steps.find(({ with: options }) => options?.profile).with
      .profile,
    "desktop",
  );
  const nativeRuns = jobs.platform.steps.flatMap(({ run }) =>
    run?.startsWith("npm ") ? [run] : [],
  );
  assert.equal(nativeRuns.length, 1);
  assert.match(nativeRuns[0], /^npm run desktop:pack:offline -- --skip-build /);
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

  // Every job that installs the default profile shares one node_modules cache key.
  for (const [name, job] of Object.entries(jobs)) {
    if (
      job.steps.some(
        ({ uses, with: options }) =>
          uses === "./.github/actions/install" && !options?.profile,
      )
    )
      assert.equal(job["runs-on"], "ubuntu-22.04", name);
  }
  assert.deepEqual(workflow().permissions, { contents: "read" });
  for (const { uses, ...step } of jobs.build.steps)
    if (uses === "actions/upload-artifact@v7")
      assert.equal(step["continue-on-error"], undefined);

  for (const group of ["cpu", "browser", "desktop"]) {
    const job = jobs[group];
    assert.equal(job["runs-on"], "ubuntu-22.04");
    if (group !== "cpu") assert.equal(job.needs, "build");
    assert(
      job.steps.some(
        ({ uses, with: options }) =>
          uses === "actions/checkout@v7" && options.lfs,
      ),
    );
    assert(
      job.steps.some(
        ({ uses, with: options }) =>
          uses === "./.github/actions/install" && !options?.profile,
      ),
    );
    const runs = job.steps.flatMap(({ run }) => (run ? [run] : []));
    const harness = runs.filter((run) => run.includes("npm run test:ci-all"));
    assert.equal(harness.length, 1);
    assert.match(harness[0], new RegExp(`--group=${group}(?:'|$)`));
    assert(!runs.some((run) => /^npm run (build|desktop:build)$/.test(run)));
    assert(
      runs.includes("npm run compatibility:generate && npm run icons:generate"),
    );
    const reports = job.steps.find(
      ({ uses }) => uses === "actions/upload-artifact@v7",
    );
    assert.equal(reports.if, "always()");
    assert.equal(reports["continue-on-error"], true);
    assert.equal(reports.with.name, `diagnostics-${group}`);
    assert.match(reports.with.path, /test-results\//);
  }
  const downloads = (job) =>
    job.steps
      .filter(({ uses }) => uses === "actions/download-artifact@v8")
      .map(({ with: options }) => options.name);
  assert.deepEqual(downloads(jobs.cpu), []);
  assert.deepEqual(downloads(jobs.browser), ["web-renderer"]);
  assert.deepEqual(downloads(jobs.desktop), ["desktop-renderer"]);
  const webDownload = jobs.browser.steps.find(
    ({ with: options }) => options?.name === "web-renderer",
  );
  assert.equal(webDownload.with.path, ".tmp/web-renderer");
  assert.equal(
    jobs.browser.env.E2E_BUILD_DIR,
    `\${{ github.workspace }}/.tmp/web-renderer`,
  );
  assert.match(
    jobs.desktop.env.ELECTRIFY_EXECUTABLE,
    /linux-unpacked\/Electrify$/,
  );
  for (const group of ["cpu", "browser", "desktop"]) {
    const steps = jobs[group].steps;
    assert.equal(
      steps.some(
        ({ uses, with: options }) =>
          uses === "actions/setup-java@v6" && options["java-version"] === "21",
      ),
      group === "cpu",
    );
    assert.equal(
      steps.some(
        ({ run }) =>
          run === "npx playwright install --with-deps --only-shell chromium",
      ),
      group !== "cpu",
    );
    assert.equal(
      steps.some(({ run }) => run?.includes("xvfb-run")),
      group === "desktop",
    );
    assert.equal(
      steps.some(
        ({ run }) => run === "sudo apt-get install --yes xvfb openbox",
      ),
      group === "desktop",
    );
  }
  assert.match(
    jobs.cpu.steps.find(({ uses }) => uses === "actions/upload-artifact@v7")
      .with.path,
    /coverage\//,
  );
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
    [...config.jobs.cpu.steps, ...config.jobs.desktop.steps]
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
    "browser",
    "build",
    "cpu",
    "desktop",
    "platform",
  ]);
  const gate = jobs.check.steps[0];
  assert.deepEqual(gate.env, {
    BUILD_RESULT: `\${{ needs.build.result }}`,
    PLATFORM_RESULT: `\${{ needs.platform.result }}`,
    CPU_RESULT: `\${{ needs.cpu.result }}`,
    BROWSER_RESULT: `\${{ needs.browser.result }}`,
    DESKTOP_RESULT: `\${{ needs.desktop.result }}`,
  });
  const successful = {
    BUILD_RESULT: "success",
    PLATFORM_RESULT: "success",
    CPU_RESULT: "success",
    BROWSER_RESULT: "success",
    DESKTOP_RESULT: "success",
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
    plan.desktop.map(({ script }) => script),
    [
      "desktop:pack:offline",
      "test:multiplayer",
      "test:steam-input",
      "test:desktop",
    ],
  );
  assert.deepEqual(
    plan.browser.map(({ script }) => script),
    ["test:e2e:ci"],
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
  assert.deepEqual(plan.desktop[0].args, [
    "--skip-build",
    "--platform",
    "linux",
    "--arch",
    "x64",
  ]);
  assert.deepEqual(
    plan.browser.find(({ script }) => script === "test:e2e:ci").args,
    ["--workers=2"],
  );
  assert.deepEqual(
    plan.desktop.find(({ script }) => script === "test:steam-input").env,
    { STEAM_INPUT_BUILD_DIR: "build" },
  );
  assert.deepEqual(plan.desktop.at(-1), {
    name: "Full packaged desktop",
    script: "test:desktop",
    args: ["--headed"],
  });
});

test("heavy phases never overlap, and failures never skip the remaining suites", async () => {
  const plan = commands(4);
  const expected = Object.values(plan).flat();
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

test("group selection covers every suite exactly once and rejects ambiguous requests", () => {
  assert.equal(parseGroup([]), "all");
  assert.equal(parseGroup(["--cpu-only"]), "cpu");
  const plan = commands(4);
  const selected = [];
  for (const group of Object.keys(plan)) {
    assert.equal(parseGroup([`--group=${group}`]), group);
    const worker = planForRun(group, { GITHUB_ACTIONS: "true" }, 4, "linux");
    assert.deepEqual(worker, { [group]: plan[group] });
    selected.push(
      ...Object.values(worker)
        .flat()
        .map(({ script }) => script),
    );
  }
  const all = Object.values(plan)
    .flat()
    .map(({ script }) => script);
  assert.deepEqual(selected, all);
  assert.equal(new Set(selected).size, all.length);
  assert.deepEqual(
    planForRun("all", { GITHUB_ACTIONS: "true" }, 4, "linux"),
    plan,
  );
  for (const args of [
    ["--group="],
    ["--group=typo"],
    ["--other"],
    ["--cpu-only", "--group=desktop"],
    ["--group=cpu", "--group=browser"],
  ])
    assert.throws(() => parseGroup(args), /Usage:/);
  assert.throws(() => planForRun("typo"), /Unknown test group/);
});

test("windowless groups retain worker limits and native windows remain CI-only on Linux", () => {
  for (const cores of [2, 4, 20]) {
    const local = planForRun("cpu", { GITHUB_ACTIONS: "false" }, cores);
    assert.deepEqual(local, { cpu: commands(cores).cpu });
    assert(
      local.cpu
        .filter(({ group }) => group)
        .every(({ args }) =>
          args.includes(`--maxWorkers=${Math.min(4, cores)}`),
        ),
    );
  }
  assert.deepEqual(planForRun("browser", {}, 4), {
    browser: commands(4).browser,
  });
  for (const group of ["all", "desktop"]) {
    assert.throws(
      () => planForRun(group, {}, 4, "linux"),
      /only for GitHub Actions/,
    );
    assert.throws(
      () => planForRun(group, { GITHUB_ACTIONS: "true" }, 4, "darwin"),
      /require Linux/,
    );
  }
  const result = spawnSync(process.execPath, ["scripts/ci/test-suites.js"], {
    env: { ...process.env, GITHUB_ACTIONS: "false" },
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /only for GitHub Actions/);
});

test("the real harness runs every selected phase after failure and retains timings and failure status", (t) => {
  const parent = path.resolve(".tmp", "test-worker-contract");
  fs.mkdirSync(parent, { recursive: true });
  const directory = fs.mkdtempSync(path.join(parent, "run-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.copyFileSync(
    "scripts/ci/test-suites.js",
    path.join(directory, "test-suites.js"),
  );
  const npm = path.join(directory, "npm.cjs");
  const record = path.join(directory, "commands.jsonl");
  const summary = path.join(directory, "summary.md");
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
  for (const [group, steps] of Object.entries(commands())) {
    for (const failing of [steps[0].script, ""]) {
      fs.writeFileSync(record, "");
      fs.writeFileSync(summary, "");
      // Only the fixture advertises Linux: every npm child is a recorder, so no window opens.
      const result = spawnSync(
        process.execPath,
        [
          "-e",
          `
        Object.defineProperty(process, 'platform', { value: 'linux' });
        require('./test-suites').main([${JSON.stringify(`--group=${group}`)}]).catch(error => {
          console.error(error); process.exitCode = 1;
        });
      `,
        ],
        {
          cwd: directory,
          encoding: "utf8",
          env: {
            ...process.env,
            GITHUB_ACTIONS: "true",
            npm_execpath: npm,
            GITHUB_STEP_SUMMARY: summary,
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
        steps.map(({ script }) => script),
      );
      for (const suite of actual.filter((step) => step.group)) {
        assert.equal(suite.shard, "1/1");
        assert(suite.args.includes("--ignore-scripts"));
      }
      const report = JSON.parse(
        fs.readFileSync(
          path.join(directory, "test-results", `ci-${group}.json`),
          "utf8",
        ),
      );
      assert.equal(report.group, group);
      assert.equal(report.schemaVersion, 1);
      assert(Number.isFinite(Date.parse(report.startedAt)));
      assert(report.durationMs >= 0);
      assert.deepEqual(
        report.phases.map(({ script }) => script),
        steps.map(({ script }) => script),
      );
      for (const phase of report.phases) {
        assert.equal(
          phase.status,
          phase.script === failing ? "failed" : "passed",
        );
        assert(phase.durationMs >= 0);
      }
      const text = fs.readFileSync(summary, "utf8");
      assert.match(text, new RegExp(`## ${group} test phases`));
      for (const phase of report.phases)
        assert(text.includes(`| ${phase.name} | ${phase.status} |`));
    }
  }
});

test("manual diagnostics stay with the worker that produces their inputs", () => {
  const { jobs } = workflow();
  const expected = {
    cpu: "node scripts/ci/benchmark-jest-cache.js",
    browser: "npm run test:e2e -- --config=e2e/ci-work.bench.config.ts",
    desktop: "node scripts/ci/benchmark-world-advance.js",
  };
  for (const [group, command] of Object.entries(expected)) {
    const step = jobs[group].steps.find(({ run }) => run?.startsWith(command));
    assert(step, `${group} retains its optional diagnostic`);
    assert.equal(
      step.if,
      "github.event_name == 'workflow_dispatch' && inputs.benchmark-work",
    );
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
