const os = require("node:os");
const { spawn } = require("node:child_process");

function cpuSuites(index, cores = os.availableParallelism()) {
  if (![1, 2].includes(index)) throw new Error("Expected CPU shard 1 or 2");
  const workers = Math.max(1, Math.ceil(cores / 2));
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
        `--coverageDirectory=test-results/jest-unit-${index}`,
        "--json",
        `--outputFile=test-results/jest-unit-${index}/results.json`,
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

function commands(index, cores = os.availableParallelism()) {
  if (!Number.isInteger(index) || index < 1 || index > 3)
    throw new Error("Expected a native platform index from 1 to 3");
  return {
    cpu: [
      ...(index === 1
        ? [
            { name: "CI tooling", script: "test:ci-tools", args: [] },
            { name: "Security rules", script: "test:rules", args: [] },
            ...cpuSuites(1, cores),
          ]
        : []),
      ...(index === 3
        ? [
            { name: "Types", script: "typecheck", args: [] },
            { name: "Strict lint", script: "lint", args: [] },
            { name: "Formatting", script: "format:check", args: [] },
          ]
        : []),
    ],
    ui: [
      {
        name: "Package and verify native depot",
        script: "desktop:pack:offline",
        args: [
          "--skip-build",
          "--platform",
          process.platform,
          "--arch",
          process.platform === "darwin" ? "universal" : process.arch,
        ],
      },
      ...([2, 3].includes(index)
        ? [
            {
              name: "Production browser",
              script: "test:e2e:ci",
              args: [`--shard=${index - 1}/2`, "--workers=2"],
            },
          ]
        : []),
      ...(index === 3
        ? [
            {
              name: "Shared-clock Steam renderer",
              script: "test:multiplayer",
              args: [],
            },
          ]
        : []),
      // Windows has spare time; Mac already owns the long shared-clock suite.
      ...(index === 2
        ? [
            {
              name: "Controller journeys",
              script: "test:steam-input",
              args: [],
              env: { STEAM_INPUT_BUILD_DIR: "build" },
            },
          ]
        : []),
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
  index,
  cpuOnly,
  env = process.env,
  cores = os.availableParallelism(),
) {
  const inCI = env.GITHUB_ACTIONS === "true";
  if (!inCI && !cpuOnly)
    throw new Error(
      "This combined native-window harness is only for GitHub Actions; use --cpu-only for a windowless local reproduction or the ordinary local checks.",
    );
  // Cap the local CPU budget while preserving CI's worker split and shard assignment.
  // execute() runs these suites serially, just as it does in CI.
  return cpuOnly
    ? { cpu: cpuSuites(index, inCI ? cores : Math.min(4, cores)), ui: [] }
    : commands(index, cores);
}

async function main(index) {
  const plan = planForRun(index, process.argv.includes("--cpu-only"));
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
              ? { TEST_GROUP: step.group, TEST_SHARD: `${index}/2` }
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
  main(Number(process.argv[2])).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
module.exports = { commands, cpuSuites, execute, planForRun };
