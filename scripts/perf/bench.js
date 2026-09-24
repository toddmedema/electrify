#!/usr/bin/env node
/**
 * `npm run perf:bench`: benchmarks B1 (tick cost) and headless B7 (rollover cost) from
 * docs/perf-plan.md.
 *
 * Like scripts/sim.js, this shells out to CRA's jest pointed at src/testing/PerfBench.tsx, which
 * needs the app's TS/JSX pipeline. That file writes its measurements to a temporary JSON file;
 * this script compares the two same-process ratios against the ceilings in bench-baselines.json
 * and exits non-zero when either is exceeded. Milliseconds are reported, never gated: a ratio
 * measured in one process cancels machine speed, an absolute time does not.
 *
 *   --runs <n>   warmed runs to take the median of (default 3; a discarded 24-month warmup precedes them)
 *   --months <n> shorten the workload while iterating locally (gating is skipped)
 *   --json       print only the machine-readable result on stdout
 *   --update     rewrite the ceilings from this run's ratios plus the tolerance headroom
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const BASELINES = path.join(__dirname, "bench-baselines.json");
const DEFAULT_TOLERANCE = 0.25;
// The worst rollover is one maximum that a GC pause can double, so it is reported; the median
// rollover held within ±5% run to run and is what gates.
const GATED = ["immerOverheadRatio", "typicalRolloverRatio"];

const USAGE = `
Usage: npm run perf:bench -- [--runs <n>] [--months <n>] [--json] [--update]
`;

function parseArgs(argv) {
  const options = { runs: 3, months: undefined, json: false, update: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(USAGE);
      process.exit(0);
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--update") {
      options.update = true;
    } else if (arg === "--runs" || arg === "--months") {
      const value = Number(argv[i + 1]);
      if (!Number.isInteger(value) || value < 1) {
        process.stderr.write(`${arg} needs a positive whole number\n`);
        process.exit(1);
      }
      options[arg.slice(2)] = value;
      i++;
    } else {
      process.stderr.write(`Unknown option ${arg}\n${USAGE}`);
      process.exit(1);
    }
  }
  return options;
}

function readBaselines() {
  return fs.existsSync(BASELINES)
    ? JSON.parse(fs.readFileSync(BASELINES, "utf8"))
    : { tolerance: DEFAULT_TOLERANCE, ceilings: {} };
}

/** Each gated ratio against its ceiling; a missing ceiling is reported but never fails. */
function gate(ratios, ceilings) {
  return GATED.map((name) => {
    const ceiling = ceilings[name];
    const value = ratios[name];
    return {
      name,
      value,
      ceiling: ceiling === undefined ? null : ceiling,
      passed: ceiling === undefined || value <= ceiling,
    };
  });
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const shortened = options.months !== undefined;
  if (options.update && shortened) {
    process.stderr.write("--update needs the full workload; drop --months\n");
    process.exit(1);
  }
  const resultFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "electrify-perf-")),
    "result.json",
  );
  const env = {
    ...process.env,
    CI: "true",
    PERF_RUNS: String(options.runs),
    PERF_RESULT_FILE: resultFile,
    PERF_QUIET: options.json ? "1" : "0",
  };
  if (shortened) {
    env.PERF_MONTHS = String(options.months);
  }
  const started = Date.now();
  const child = spawnSync(
    process.execPath,
    [
      require.resolve("react-scripts/bin/react-scripts.js", { paths: [ROOT] }),
      "test",
      "--watchAll=false",
      "--testMatch",
      "**/src/testing/PerfBench.tsx",
    ],
    // With --json, keep stdout for the JSON alone by sending jest's output to stderr
    {
      stdio: ["inherit", options.json ? 2 : "inherit", "inherit"],
      env,
      cwd: ROOT,
    },
  );
  if (child.status !== 0 || !fs.existsSync(resultFile)) {
    process.stderr.write("perf:bench: the benchmark itself failed\n");
    process.exit(child.status || 1);
  }
  const result = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  fs.rmSync(path.dirname(resultFile), { recursive: true, force: true });
  result.wallSeconds = (Date.now() - started) / 1000;
  result.node = process.version;

  const baselines = readBaselines();
  const tolerance = baselines.tolerance ?? DEFAULT_TOLERANCE;
  if (options.update) {
    const next = {
      tolerance,
      recordedWith: {
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        runs: options.runs,
        date: new Date().toISOString().slice(0, 10),
      },
      measured: {},
      ceilings: {},
    };
    GATED.forEach((name) => {
      next.measured[name] = Number(result.ratios[name].toFixed(3));
      next.ceilings[name] = Number(
        (result.ratios[name] * (1 + tolerance)).toFixed(3),
      );
    });
    fs.writeFileSync(BASELINES, JSON.stringify(next, null, 2) + "\n");
    baselines.ceilings = next.ceilings;
  }

  // A shortened workload has fewer rollovers, so its worst case is not comparable
  const gates = shortened ? [] : gate(result.ratios, baselines.ceilings || {});
  result.gates = gates;
  const failed = gates.filter((g) => !g.passed);

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    process.stdout.write("\n");
    if (shortened) {
      process.stdout.write(
        `  Gates skipped: --months ${options.months} is not the baselined workload\n`,
      );
    }
    gates.forEach((g) =>
      process.stdout.write(
        `  ${g.passed ? "ok  " : "FAIL"} ${g.name.padEnd(20)} ${g.value.toFixed(2).padStart(8)}` +
          `  ceiling ${g.ceiling === null ? "none" : g.ceiling.toFixed(2)}\n`,
      ),
    );
    if (options.update) {
      process.stdout.write(
        `  Ceilings rewritten in ${path.relative(ROOT, BASELINES)} (+${tolerance * 100}%)\n`,
      );
    }
    process.stdout.write(
      `  perf:bench took ${result.wallSeconds.toFixed(1)} s on Node ${process.version}\n\n`,
    );
    if (failed.length) {
      process.stdout.write(
        "  A gated ratio rose past its ceiling. If the change is intended, run " +
          "`npm run perf:rebaseline` and commit bench-baselines.json.\n\n",
      );
    }
  }
  process.exit(failed.length ? 1 : 0);
}

main();
