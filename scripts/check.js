#!/usr/bin/env node
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const os = require("node:os");
const { checkAssets } = require("./check-assets");
const cache = require("./ci/validation-cache");

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
    reports: ["results.json"],
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
    reports: ["results.json"],
  },
  {
    id: "steam-input",
    name: "Controller journeys",
    script: "test:steam-input",
    ci: true,
    needs: "desktop-build",
    env: { STEAM_INPUT_BUILD_DIR: "build" },
    reports: ["results.json"],
  },
];
const usage = `Usage: npm run check -- [--ci] [--resume] [--steps ${steps.map((step) => step.id).join(",")}]\n       npm run check -- --report <report.json>`;

// The default check omits CI-only gates; --ci runs every gate, and --steps may name any gate.
// Build prerequisites remain selected even on resume: they must execute or have verified evidence.
function selectSteps(argv) {
  if (argv.filter((arg) => arg === "--resume").length > 1)
    throw new Error(usage);
  argv = argv.filter((arg) => arg !== "--resume");
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

function configuredStep(step, hosted = process.env.GITHUB_ACTIONS === "true") {
  if (hosted) return step;
  const web = ".tmp/check-builds/web";
  const desktop = ".tmp/check-builds/desktop";
  const overrides = {
    build: { BUILD_PATH: web },
    bundle: { BUILD_PATH: web },
    browser: { E2E_BUILD_DIR: web },
    "desktop-build": { BUILD_PATH: desktop },
    multiplayer: { MULTIPLAYER_BUILD_DIR: desktop },
    "steam-input": { STEAM_INPUT_BUILD_DIR: desktop },
  };
  return { ...step, env: { ...step.env, ...overrides[step.id] } };
}

function artifactDirectory(step) {
  if (["build", "bundle", "desktop-build"].includes(step.id))
    return step.env?.BUILD_PATH || "build";
  if (step.id === "browser") return step.env?.E2E_BUILD_DIR || "build";
  if (step.id === "multiplayer")
    return step.env?.MULTIPLAYER_BUILD_DIR || "build";
  if (step.id === "steam-input")
    return step.env?.STEAM_INPUT_BUILD_DIR || "build";
  return null;
}

function artifactDigest(step) {
  const directory = artifactDirectory(step);
  if (!directory) return undefined;
  try {
    return cache.digestDirectory(path.resolve(directory));
  } catch {
    return null;
  } // Missing/corrupt artifacts can never authorize reuse.
}

function commandArguments(step, workers) {
  return [
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
}

function gateEnvironment(step, directory) {
  return {
    CI: "true",
    ...step.env,
    ...(step.reports?.length
      ? { ELECTRIFY_E2E_OUTPUT_DIR: path.join(directory, step.id) }
      : {}),
  };
}

function inputKey(step, workers, directory) {
  return cache.gateKey(step, {
    root: process.cwd(),
    inputs: cache.sourceInputs(process.cwd()),
    command: ["npm", ...commandArguments(step, workers)],
    env: { ...process.env, ...gateEnvironment(step, directory) },
    workers,
    artifactDigest: ["build", "desktop-build"].includes(step.id)
      ? undefined
      : artifactDigest(step),
  });
}

function behaviorFingerprint(root = process.cwd()) {
  const inputs = cache
    .sourceInputs(root)
    .filter(({ digest }) => digest !== "missing");
  return createHash("sha256").update(JSON.stringify(inputs)).digest("hex");
}

function reuseGate(previous, step, directory) {
  const origin = path.dirname(previous.reportPath);
  for (const file of [previous.gate.log, ...(previous.gate.reports || [])]) {
    const target = path.join(directory, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(origin, file), target);
  }
  if (
    cache.evidenceDigest(directory, previous.gate) !==
    previous.gate.evidenceDigest
  )
    throw new Error("Retained evidence changed while copying it");
  return {
    ...step,
    ...previous.gate,
    ok: true,
    status: "passed",
    execution: "reused",
    originalSeconds: previous.gate.originalSeconds ?? previous.gate.seconds,
    seconds: 0,
    env: gateEnvironment(step, directory),
    reusedFrom: {
      report: path.relative(process.cwd(), previous.reportPath),
      gate: step.id,
    },
  };
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

// Compare actual source bytes, including untracked and known ignored behavior inputs.
// Git index/commit state is report provenance, not a change to the code being checked.
function sourceSnapshot(cwd = process.cwd()) {
  const options = {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 64 * 1024 * 1024,
  };
  let root;
  try {
    root = execFileSync(
      "git",
      ["rev-parse", "--show-toplevel"],
      options,
    ).trim();
  } catch {
    // The runner also supports source archives without Git metadata.
    return null;
  }
  const git = (...args) => execFileSync("git", args, { ...options, cwd: root });
  const commit = git("rev-parse", "HEAD").trim();
  const tree = git("rev-parse", "HEAD^{tree}").trim();
  const status = git("status", "--porcelain=v1", "--untracked-files=all");
  return {
    commit,
    tree,
    dirty: status.length > 0,
    fingerprint: behaviorFingerprint(root),
  };
}

// A retained pass describes its recorded scope, never a later checkout or a partial retry.
function summarizeReport(report, current = sourceSnapshot()) {
  if (report.schemaVersion !== 1 || !Array.isArray(report.gates))
    throw new Error("Unsupported validation report");
  const full =
    report.scope?.full === true &&
    report.scope.profile === "ci" &&
    report.gates.length === steps.length &&
    steps.every(({ id }) => report.gates.some((gate) => gate.id === id));
  const passed = report.gates.filter(({ status }) => status === "passed");
  const source = report.source?.after;
  const same =
    !!current?.fingerprint && current.fingerprint === source?.fingerprint;
  return [
    `Local validation: ${report.status} (${full ? "full CI profile" : "partial/quick check"}; ${passed.length}/${report.gates.length} gates passed).`,
    `Tested commit: ${source?.commit ?? "unavailable"}${source?.dirty ? " with working-tree changes" : ""}.`,
    `Source fingerprint: ${source?.fingerprint ?? "unavailable"}.`,
    `Current source: ${same ? "matches the recorded snapshot" : "not verified by this report; the snapshot differs or is unavailable"}.`,
    `Runtime: ${report.environment?.node}, ${report.environment?.platform}/${report.environment?.arch}; Jest workers: ${report.environment?.jestWorkers}.`,
    `Passed gates: ${passed.map(({ id }) => id).join(", ") || "none"}.`,
    `Reused gates: ${
      passed
        .filter(({ execution }) => execution === "reused")
        .map(({ id }) => id)
        .join(", ") || "none"
    }; see each gate's reusedFrom for original evidence.`,
    ...report.gates
      .filter(({ status }) => status !== "passed")
      .map(({ id, status }) => `${id}: ${status}.`),
    `Outside local scope: ${(report.scope?.ciOnly || []).join(", ") || "none"} (CI only); ${(report.scope?.separateChecks || []).join(", ") || "none"} (separate checks).`,
  ].join("\n");
}

function run(step, workers, directory) {
  const started = Date.now();
  console.error(
    `Starting ${step.name}${step.jest ? ` (${workers} workers)` : ""}...`,
  );
  return new Promise((resolve) => {
    const args = commandArguments(step, workers);
    const reportEnv = step.reports?.length
      ? { ELECTRIFY_E2E_OUTPUT_DIR: path.join(directory, step.id) }
      : {};
    const options = {
      env: {
        ...process.env,
        CI: "true",
        NO_COLOR: "1",
        ...step.env,
        ...reportEnv,
      },
      windowsHide: true,
    };
    // Output paths travel in the environment, keeping dynamic paths out of the Windows shell.
    // Each invocation owns its artifacts; reruns cannot replace or borrow earlier evidence.
    const child =
      process.platform === "win32"
        ? spawn(["npm", ...args].join(" "), { ...options, shell: true })
        : spawn("npm", args, options);
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", (error) => (output += `\n${error.message}`));
    child.on("close", (code, signal) => {
      const seconds = (Date.now() - started) / 1000;
      const log = `${step.id}.log`;
      const reports = [];
      const reportErrors = [];
      for (const file of step.reports || []) {
        try {
          const retained = path.join(step.id, file);
          JSON.parse(fs.readFileSync(path.join(directory, retained), "utf8"));
          reports.push(retained);
        } catch (error) {
          reportErrors.push(
            `Required report ${file} is missing or invalid: ${error.message}`,
          );
        }
      }
      const ok = code === 0 && !reportErrors.length;
      if (reportErrors.length) output += `\n${reportErrors.join("\n")}\n`;
      fs.writeFileSync(path.join(directory, log), output);
      if (!ok)
        console.error(`\n===== ${step.name} failed =====\n${output.trimEnd()}`);
      console.error(
        `${ok ? "ok  " : "FAIL"} ${step.name.padEnd(18)} ${seconds.toFixed(0)}s${!ok && step.fix ? `  fix: ${step.fix}` : ""}`,
      );
      resolve({
        ...step,
        ok,
        status: ok ? "passed" : "failed",
        seconds,
        exitCode: code,
        signal,
        command: ["npm", ...args],
        env: { CI: "true", ...step.env, ...reportEnv },
        log,
        reports,
        reportErrors,
      });
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
      results.push({
        ...step,
        ok: false,
        status: "skipped",
        reason: `${needed.name} failed`,
        seconds: 0,
      });
    } else results.push(await runStep(step));
  }
  return results;
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length === 2 && argv[0] === "--report") {
    process.stdout.write(
      `${summarizeReport(JSON.parse(fs.readFileSync(argv[1], "utf8")))}\n`,
    );
    return;
  }
  if (argv.length === 1 && argv[0] === "--help") {
    console.error(usage);
    return;
  }
  const selected = selectSteps(argv);
  const workers = workerCount(process.env);
  if (selected.some((step) => step.assets)) checkAssets();
  const sourceBefore = sourceSnapshot();
  const reusable =
    process.env.GITHUB_ACTIONS !== "true" && sourceBefore !== null;
  const resume = reusable && argv.includes("--resume");
  const started = Date.now();
  const full = isFullCheck(selected);
  const available = full ? selected.length : steps.length;
  const parent = path.resolve(".tmp", "check-runs");
  fs.mkdirSync(parent, { recursive: true });
  const directory = fs.mkdtempSync(
    path.join(parent, `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-`),
  );
  const reportPath = path.join(directory, "report.json");
  const report = {
    schemaVersion: 1,
    status: "running",
    startedAt: new Date(started).toISOString(),
    command: ["node", "scripts/check.js", ...argv],
    source: {
      before: sourceBefore,
      after: null,
      changedDuringRun: false,
      behaviorBefore: reusable ? behaviorFingerprint() : null,
    },
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cores: os.availableParallelism(),
      jestWorkers: workers,
      githubActions: process.env.GITHUB_ACTIONS === "true",
      e2ePort: process.env.E2E_PORT || "3100",
      webBuildDirectory:
        configuredStep(steps.find(({ id }) => id === "build")).env
          ?.BUILD_PATH || "build",
    },
    timing: {
      queueMs: Number(process.env.ELECTRIFY_COORDINATION_WAIT_MS || 0),
    },
    scope: {
      profile: selected.some((step) => step.ci) ? "ci" : "quick",
      resume,
      full,
      selected: selected.map((step) => step.id),
      notSelected: steps
        .filter((step) => !selected.includes(step))
        .map((step) => step.id),
      ciOnly: ["packaged-electron"],
      separateChecks: ["firestore-rules"],
    },
    gates: selected.map(({ id, name, script, env }) => ({
      id,
      name,
      script,
      env: { CI: "true", ...env },
      status: "pending",
    })),
  };
  const saveReport = () =>
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  saveReport();
  console.error(`Running ${selected.length}/${available} check gates.`);
  console.error(`Validation report: ${reportPath}`);
  const results = await execute(
    selected.map((step) => configuredStep(step)),
    async (step) => {
      const gate = report.gates.find((entry) => entry.id === step.id);
      const gateStartedAt = new Date().toISOString();
      Object.assign(gate, {
        status: "running",
        startedAt: gateStartedAt,
      });
      saveReport();
      let result;
      try {
        const key = reusable ? inputKey(step, workers, directory) : undefined;
        const artifact = reusable ? artifactDigest(step) : undefined;
        const previous =
          resume && (!artifactDirectory(step) || artifact)
            ? cache.findReusable(parent, step, key, artifact)
            : null;
        if (previous) {
          try {
            result = reuseGate(previous, step, directory);
            console.error(
              `reuse ${step.name.padEnd(18)} ${path.relative(parent, previous.reportPath)}`,
            );
          } catch (error) {
            console.error(
              `Cannot reuse ${step.name}: ${error.message}; running it.`,
            );
          }
        }
        if (!result) {
          result = {
            ...(await run(step, workers, directory)),
            execution: "executed",
          };
          if (reusable) {
            const after = inputKey(step, workers, directory);
            result.inputKey = key === after ? key : null;
            result.artifactDigest = artifactDigest(step);
            if (result.ok)
              result.evidenceDigest = cache.evidenceDigest(directory, result);
          }
        }
      } catch (error) {
        console.error(`FAIL ${step.name}: ${error.message}`);
        result = {
          ...step,
          ok: false,
          status: "failed",
          execution: "executed",
          seconds: 0,
          reason: error.message,
        };
      }
      Object.assign(gate, result, {
        startedAt: gateStartedAt,
        finishedAt: new Date().toISOString(),
      });
      saveReport();
      return result;
    },
  );
  // Dependency failures do not invoke run(), so record their skipped status explicitly.
  for (const result of results)
    if (result.status === "skipped")
      Object.assign(
        report.gates.find((gate) => gate.id === result.id),
        result,
      );
  const failed = results.filter((result) => !result.ok);
  report.source.after = sourceSnapshot();
  report.source.behaviorAfter = reusable ? behaviorFingerprint() : null;
  report.source.changedDuringRun =
    (!!report.source.before &&
      report.source.before.fingerprint !== report.source.after?.fingerprint) ||
    report.source.behaviorBefore !== report.source.behaviorAfter;
  report.status = report.source.changedDuringRun
    ? "invalidated"
    : failed.length
      ? "failed"
      : "passed";
  report.finishedAt = new Date().toISOString();
  report.timing.executionMs = Date.now() - started;
  report.timing.reusedGates = results.filter(
    ({ execution }) => execution === "reused",
  ).length;
  saveReport();
  if (report.source.changedDuringRun) {
    console.error(
      "Source changed during validation; these results do not validate one source tree. Rerun the integrated check.",
    );
    process.exitCode = 1;
  }
  console.error(
    `\n${report.source.changedDuringRun ? `Invalidated ${results.length}` : failed.length ? `Failed ${failed.length}/${results.length}` : `Passed ${results.length}`} gates in ${((Date.now() - started) / 1000).toFixed(0)}s.${full ? "" : " Partial check only."}${full && !selected.some((step) => step.ci) ? " Run npm run check:ci before pushing a pull request." : ""}`,
  );
  if (full && selected.some((step) => step.ci))
    console.error(
      "Packaged Electron UI tests are CI-only and are not included in this check.",
    );
  if (failed.length) {
    if (full && reusable)
      console.error(
        `Resume all required gates with verified reuse: npm run check${selected.some((step) => step.ci) ? ":ci" : ""} -- --resume`,
      );
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
module.exports = {
  steps,
  selectSteps,
  isFullCheck,
  workerCount,
  execute,
  summarizeReport,
  configuredStep,
  sourceSnapshot,
};
