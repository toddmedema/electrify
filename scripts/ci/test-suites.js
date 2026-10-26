const os = require("node:os");
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
    ui: [
      {
        // Build a separate Linux test package, so OS build jobs cannot block this worker.
        name: "Package and verify test depot",
        script: "desktop:pack:offline",
        args: ["--skip-build", "--platform", "linux", "--arch", "x64"],
      },
      {
        name: "Production browser",
        script: "test:e2e:ci",
        args: ["--workers=2"],
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
  for (const step of [...plan.cpu, ...plan.ui]) results.push(await run(step));
  return results;
}

function planForRun(
  cpuOnly,
  env = process.env,
  cores = os.availableParallelism(),
) {
  const inCI = env.GITHUB_ACTIONS === "true";
  if (!inCI && !cpuOnly)
    throw new Error(
      "This combined native-window harness is only for GitHub Actions; use --cpu-only for a windowless local reproduction or the ordinary local checks.",
    );
  if (!cpuOnly && process.platform !== "linux")
    throw new Error("The combined test worker requires Linux");
  const plan = commands(cores);
  return cpuOnly ? { ...plan, ui: [] } : plan;
}

async function main() {
  const plan = planForRun(process.argv.includes("--cpu-only"));
  const run = (step) =>
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
  const results = await execute(plan, run);
  if (results.some((passed) => !passed)) process.exitCode = 1;
}

if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
module.exports = { commands, cpuSuites, execute, planForRun };
