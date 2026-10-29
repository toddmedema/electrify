const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

function cpuSuites(cores = os.availableParallelism()) {
  const workers = Math.max(1, Math.min(4, cores));
  return [
    {
      name: "Covered units",
      script: "test:ci",
      group: "unit",
      args: [
        "--filter=./scripts/ci/jest-filter.js",
        "--cacheDirectory=.tmp/jest-unit",
        `--maxWorkers=${workers}`,
        "--coverageThreshold={}",
        "--coverageReporters=json",
        "--coverageDirectory=test-results/jest-unit-1",
        "--json",
        "--outputFile=test-results/jest-unit-1/results.json",
      ],
    },
    {
      name: "Simulations",
      script: "test:sim",
      group: "simulation",
      args: [
        "--filter=./scripts/ci/jest-filter.js",
        "--cacheDirectory=.tmp/jest-simulation",
        `--maxWorkers=${workers}`,
      ],
    },
  ];
}

function commands(cores = os.availableParallelism()) {
  return {
    cpu: [
      { name: "Types", script: "typecheck", args: [] },
      { name: "Strict lint", script: "lint", args: [] },
      { name: "Formatting", script: "format:check", args: [] },
      { name: "Native desktop units", script: "test:desktop:native", args: [] },
      { name: "CI tooling", script: "test:ci-tools", args: [] },
      { name: "Security rules", script: "test:rules", args: [] },
      { name: "Tick performance", script: "perf:bench", args: [] },
      ...cpuSuites(cores),
      {
        name: "Every unit suite and coverage floor",
        script: "test:ci-coverage",
        args: [],
      },
      {
        name: "Simulation CLI",
        script: "sim",
        args: ["--scenario", "101", "--months", "12"],
      },
    ],
    browser: [
      {
        name: "Production browser",
        script: "test:e2e:ci",
        args: ["--workers=2"],
      },
    ],
    desktop: [
      {
        // Build a separate Linux test package, so OS build jobs cannot block this worker.
        name: "Package and verify test depot",
        script: "desktop:pack:offline",
        args: ["--skip-build", "--platform", "linux", "--arch", "x64"],
      },
      {
        name: "Shared-clock Steam renderer",
        script: "test:multiplayer",
        args: [],
      },
      {
        name: "Controller journeys",
        script: "test:steam-input",
        args: [],
        env: { STEAM_INPUT_BUILD_DIR: "build" },
      },
      {
        name: "Full packaged desktop",
        script: "test:desktop",
        args: ["--headed"],
      },
    ],
  };
}
async function execute(plan, run) {
  const results = [];
  // Match local check:ci's resource isolation. Covered Jest, simulations and native renderers
  // each consume the runner's CPU budget; overlapping them makes UI deadlines load-dependent.
  for (const step of Object.values(plan).flat()) results.push(await run(step));
  return results;
}

function parseGroup(args) {
  if (!args.length) return "all";
  if (args.length === 1 && args[0] === "--cpu-only") return "cpu";
  if (args.length === 1 && /^--group=(cpu|browser|desktop|all)$/.test(args[0]))
    return args[0].slice("--group=".length);
  throw new Error(
    "Usage: test:ci-all -- [--group=cpu|browser|desktop|all | --cpu-only]",
  );
}

function planForRun(
  group,
  env = process.env,
  cores = os.availableParallelism(),
  platform = process.platform,
) {
  const plan = commands(cores);
  if (group !== "all" && !Object.hasOwn(plan, group))
    throw new Error(`Unknown test group: ${group}`);
  const selected = group === "all" ? plan : { [group]: plan[group] };
  if (selected.desktop) {
    if (env.GITHUB_ACTIONS !== "true")
      throw new Error(
        "Native-window test groups are only for GitHub Actions; use --cpu-only for a windowless local reproduction or the ordinary local checks.",
      );
    if (platform !== "linux")
      throw new Error("Native test groups require Linux");
  }
  return selected;
}

async function main(args = process.argv.slice(2)) {
  const group = parseGroup(args);
  const plan = planForRun(group);
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const phases = [];
  const spawnStep = (step) =>
    new Promise((resolve) => {
      console.error(`Starting ${step.name}`);
      // Manifests were generated before packaging. Suppress redundant npm pre-hooks so every
      // phase reads the same generated inputs as the shared production builds.
      const child = spawn(
        process.execPath,
        [
          process.env.npm_execpath,
          ...(step.group ||
          ["test:e2e:ci", "test:steam-input", "typecheck"].includes(step.script)
            ? ["--ignore-scripts"]
            : []),
          "run",
          step.script,
          "--",
          ...step.args,
        ],
        {
          stdio: "inherit",
          windowsHide: true,
          env: {
            ...process.env,
            ...step.env,
            ...(step.group
              ? { TEST_GROUP: step.group, TEST_SHARD: "1/1" }
              : {}),
          },
        },
      );
      child.on("error", (error) => {
        console.error(error);
        resolve(false);
      });
      child.on("exit", (code) => {
        console.error(`${step.name}: ${code === 0 ? "passed" : "FAILED"}`);
        resolve(code === 0);
      });
    });
  // Failures are collected without skipping any remaining CPU or UI phase.
  const results = await execute(plan, async (step) => {
    const start = performance.now();
    const passed = await spawnStep(step);
    phases.push({
      name: step.name,
      script: step.script,
      status: passed ? "passed" : "failed",
      durationMs: Math.round(performance.now() - start),
    });
    return passed;
  });
  const report = {
    schemaVersion: 1,
    group,
    startedAt,
    durationMs: Math.round(performance.now() - started),
    phases,
  };
  fs.mkdirSync("test-results", { recursive: true });
  fs.writeFileSync(
    path.join("test-results", `ci-${group}.json`),
    JSON.stringify(report, null, 2) + "\n",
  );
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## ${group} test phases\n\n| Phase | Result | Seconds |\n| --- | --- | ---: |\n` +
        phases
          .map(
            (phase) =>
              `| ${phase.name} | ${phase.status} | ${(phase.durationMs / 1000).toFixed(1)} |\n`,
          )
          .join("") +
        "\n",
    );
  }
  if (results.some((passed) => !passed)) process.exitCode = 1;
}

if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
module.exports = { commands, cpuSuites, execute, parseGroup, planForRun, main };
