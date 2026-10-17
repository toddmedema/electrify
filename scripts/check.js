#!/usr/bin/env node
const { spawn } = require("node:child_process");
const os = require("node:os");
const { checkAssets } = require("./check-assets");

const steps = [
  { id: "types", name: "Types", script: "typecheck", parallel: true },
  {
    id: "lint",
    name: "Lint",
    script: "lint",
    parallel: true,
    fix: "npm run lint:fix",
  },
  {
    id: "formatting",
    name: "Formatting",
    script: "format:check",
    parallel: true,
    fix: "npm run format",
  },
  { id: "desktop", name: "Desktop runtime", script: "test:desktop:native" },
  { id: "tooling", name: "CI tooling", script: "test:ci-tools" },
  { id: "tests", name: "Tests", script: "test:ci", jest: true, assets: true },
  {
    id: "simulations",
    name: "Simulation tests",
    script: "test:sim",
    jest: true,
    assets: true,
  },
  {
    id: "sim",
    name: "Simulation CLI",
    assets: true,
    script: "sim",
    args: ["--", "--scenario", "101", "--months", "12"],
  },
];

function selectSteps(argv) {
  if (!argv.length) return steps;
  if (argv.length !== 2 || argv[0] !== "--steps")
    throw new Error("Usage: npm run check -- [--steps types,lint,...]");
  const ids = argv[1].split(",");
  if (ids.some((id) => !steps.some((step) => step.id === id)))
    throw new Error(
      `Unknown check step. Choose from: ${steps.map((step) => step.id).join(", ")}`,
    );
  return steps.filter((step) => ids.includes(step.id));
}

function workerCount(env, cores = os.availableParallelism()) {
  const value = env.ELECTRIFY_CHECK_WORKERS;
  if (
    value !== undefined &&
    (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))
  )
    throw new Error("ELECTRIFY_CHECK_WORKERS must be a positive safe integer");
  return value === undefined ? Math.min(4, cores) : Number(value);
}

function run(step, workers) {
  const started = Date.now();
  console.error(
    `Starting ${step.name}${step.jest ? ` (${workers} workers)` : ""}...`,
  );
  return new Promise((resolve) => {
    const args = [
      "run",
      "--silent",
      step.script,
      ...(step.jest
        ? [
            "--",
            `--maxWorkers=${workers}`,
            `--cacheDirectory=.tmp/jest-check-${step.id}`,
          ]
        : step.args || []),
    ];
    const options = {
      env: { ...process.env, CI: "true", NO_COLOR: "1" },
      windowsHide: true,
    };
    // Only allowlisted script names, flags and validated worker counts reach the Windows shell.
    const child =
      process.platform === "win32"
        ? spawn(["npm", ...args].join(" "), { ...options, shell: true })
        : spawn("npm", args, options);
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", (error) => (output += `\n${error.message}`));
    child.on("close", (code) => {
      const seconds = (Date.now() - started) / 1000;
      if (code !== 0)
        console.error(`\n===== ${step.name} failed =====\n${output.trimEnd()}`);
      console.error(
        `${code === 0 ? "ok  " : "FAIL"} ${step.name.padEnd(18)} ${seconds.toFixed(0)}s${code !== 0 && step.fix ? `  fix: ${step.fix}` : ""}`,
      );
      resolve({ ...step, ok: code === 0, seconds });
    });
  });
}

async function execute(selected, runStep) {
  const results = await Promise.all(
    selected.filter((step) => step.parallel).map(runStep),
  );
  // Keep CPU-heavy suites serial, including when retrying a subset of gates.
  for (const step of selected.filter((step) => !step.parallel))
    results.push(await runStep(step));
  return results;
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === "--help") {
    console.error(
      `Usage: npm run check -- [--steps ${steps.map((step) => step.id).join(",")}]`,
    );
    return;
  }
  const selected = selectSteps(argv);
  const workers = workerCount(process.env);
  if (selected.some((step) => step.assets)) checkAssets();
  const started = Date.now();
  console.error(`Running ${selected.length}/${steps.length} check gates.`);
  const results = await execute(selected, (step) => run(step, workers));
  const failed = results.filter((result) => !result.ok);
  console.error(
    `\n${failed.length ? `Failed ${failed.length}/${results.length}` : `Passed ${results.length}`} gates in ${((Date.now() - started) / 1000).toFixed(0)}s.${selected.length < steps.length ? " Partial check only." : ""}`,
  );
  if (failed.length) {
    console.error(
      `After fixing these failures, rerun: npm run check -- --steps ${failed.map((step) => step.id).join(",")}`,
    );
    process.exitCode = 1;
  }
}

if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { steps, selectSteps, workerCount, execute };
