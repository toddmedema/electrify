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
      {
        name: "Full packaged desktop",
        script: "test:desktop",
        args: ["--headed"],
      },
    ],
  };
}
async function execute(plan, run) {
  async function sequence(steps) {
    const results = [];
    for (const step of steps) results.push(await run(step));
    return results;
  }
  async function cpu() {
    const checks = await sequence(plan.cpu.filter((step) => !step.group));
    const suites = await Promise.all(
      plan.cpu.filter((step) => step.group).map(run),
    );
    return [...checks, ...suites];
  }
  return (await Promise.all([cpu(), sequence(plan.ui)])).flat();
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
  // Share at most four local workers across both concurrent suites. Keep CI's native
  // plan intact while allowing its CPU contention and shard assignment to be reproduced.
  return cpuOnly
    ? { cpu: cpuSuites(index, inCI ? cores : Math.min(4, cores)), ui: [] }
    : commands(index, cores);
}

async function main(index) {
  const plan = planForRun(index, process.argv.includes("--cpu-only"));
  const run = (step) =>
    new Promise((resolve) => {
      console.error(`Starting ${step.name}`);
      // Manifests were generated before packaging. Suppress their duplicate npm pre-hooks
      // so parallel test branches never rewrite generated source beneath one another.
      const child = spawn(
        process.execPath,
        [
          process.env.npm_execpath,
          ...(step.group || ["test:e2e:ci", "typecheck"].includes(step.script)
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
  // Independent CPU suites overlap; packaging/browser/native UI stay serial.
  const results = await execute(plan, run);
  if (results.some((passed) => !passed)) process.exitCode = 1;
}

if (require.main === module)
  main(Number(process.argv[2])).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
module.exports = { commands, cpuSuites, execute, planForRun };
