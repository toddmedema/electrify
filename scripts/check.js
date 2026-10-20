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
  // CI-only gates, added by --ci. They need a production build and headless Chromium, so the
  // quick default check skips them; run them before opening or updating a pull request.
  // The packaged Electron suite opens native windows and stays in CI.
  {
    id: "bench",
    name: "Tick performance",
    script: "perf:bench",
    ci: true,
    assets: true,
  },
  {
    id: "build",
    name: "Production build",
    script: "build",
    ci: true,
    assets: true,
    env: { DISABLE_ESLINT_PLUGIN: "true" },
  },
  {
    id: "bundle",
    name: "Bundle size",
    script: "perf:bundle",
    ci: true,
    needs: "build",
  },
  {
    id: "browser",
    name: "Production browser",
    script: "test:e2e:ci",
    ci: true,
    assets: true,
    needs: "build",
    args: ["--", "--reporter=list"],
  },
  {
    id: "desktop-build",
    name: "Desktop renderer",
    script: "desktop:build",
    ci: true,
    assets: true,
    env: { DISABLE_ESLINT_PLUGIN: "true" },
  },
  {
    id: "multiplayer",
    name: "Multiplayer",
    script: "test:multiplayer",
    ci: true,
    needs: "desktop-build",
    env: { MULTIPLAYER_BUILD_DIR: "build" },
  },
];
const usage = `Usage: npm run check -- [--ci] [--steps ${steps.map((step) => step.id).join(",")}]`;

// The default check omits CI-only gates; --ci runs every gate, and --steps may name any gate.
// Selecting a gate that tests a build also rebuilds it, because the two builds share build/.
function selectSteps(argv) {
  const ci = argv[0] === "--ci";
  if (ci) argv = argv.slice(1);
  if (!argv.length) return ci ? steps : steps.filter((step) => !step.ci);
  if (argv.length !== 2 || argv[0] !== "--steps") throw new Error(usage);
  const ids = argv[1].split(",");
  if (ids.some((id) => !steps.some((step) => step.id === id)))
    throw new Error(
      `Unknown check step. Choose from: ${steps.map((step) => step.id).join(", ")}`,
    );
  const needed = steps
    .filter((step) => ids.includes(step.id))
    .map((step) => step.needs);
  return steps.filter(
    (step) => ids.includes(step.id) || needed.includes(step.id),
  );
}

function isFullCheck(selected) {
  const ci = selected.some((step) => step.ci);
  return steps.every((step) => selected.includes(step) || (step.ci && !ci));
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
      env: { ...process.env, CI: "true", NO_COLOR: "1", ...step.env },
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
  for (const step of selected.filter((step) => !step.parallel)) {
    const needed = results.find((result) => result.id === step.needs);
    if (needed && !needed.ok) {
      console.error(`skip ${step.name} (${needed.name} failed)`);
      results.push({ ...step, ok: false, seconds: 0 });
    } else results.push(await runStep(step));
  }
  return results;
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === "--help") {
    console.error(usage);
    return;
  }
  const selected = selectSteps(argv);
  const workers = workerCount(process.env);
  if (selected.some((step) => step.assets)) checkAssets();
  const started = Date.now();
  const full = isFullCheck(selected);
  const available = full ? selected.length : steps.length;
  console.error(`Running ${selected.length}/${available} check gates.`);
  const results = await execute(selected, (step) => run(step, workers));
  const failed = results.filter((result) => !result.ok);
  console.error(
    `\n${failed.length ? `Failed ${failed.length}/${results.length}` : `Passed ${results.length}`} gates in ${((Date.now() - started) / 1000).toFixed(0)}s.${full ? "" : " Partial check only."}${full && !selected.some((step) => step.ci) ? " Run npm run check:ci before pushing a pull request." : ""}`,
  );
  if (full && selected.some((step) => step.ci))
    console.error(
      "Packaged Electron UI tests are CI-only and are not included in this check.",
    );
  if (failed.length) {
    console.error(
      "This retry covers only failed gates. Also rerun any passing gates whose inputs changed during the repair; use npm run check if unsure.",
    );
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
module.exports = { steps, selectSteps, isFullCheck, workerCount, execute };
