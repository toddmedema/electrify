#!/usr/bin/env node
/**
 * Bundle size gate (benchmark B5 in docs/perf-plan.md). Reads the CRA production output in
 * build/, gzips each shipped chunk at level 9, and compares the totals with the ceilings in
 * bundle-baselines.json. Any metric more than 1% over its ceiling fails. Run after
 * `npm run build`; it needs no browser, so CI runs it right after the production build.
 *
 *   node scripts/perf/bundle-size.js            compare against the ceilings
 *   node scripts/perf/bundle-size.js --update   rewrite the ceilings to the current build
 *   node scripts/perf/bundle-size.js --json     print the measurements as JSON
 *
 * When $GITHUB_STEP_SUMMARY is set, a markdown table is appended to it.
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const root = path.resolve(__dirname, "../..");
const buildDir = path.join(root, "build");
const baselinesPath = path.join(__dirname, "bundle-baselines.json");
const tolerance = 0.01;

const metrics = [
  { key: "mainJs", label: "Main JS chunk" },
  { key: "mainCss", label: "Main CSS" },
  { key: "initialJs", label: "Initial JS (entrypoints)" },
  { key: "allJs", label: "All JS (including lazy chunks)" },
];

function print(line = "") {
  process.stdout.write(`${line}\n`);
}

function fail(message) {
  console.error(`bundle-size: ${message}`);
  process.exit(1);
}

function gzipBytes(relative) {
  const raw = fs.readFileSync(path.join(buildDir, relative));
  return zlib.gzipSync(raw, { level: 9 }).length;
}

function sum(files) {
  return files.reduce((total, file) => total + gzipBytes(file), 0);
}

function measure() {
  const manifestPath = path.join(buildDir, "asset-manifest.json");
  if (!fs.existsSync(manifestPath)) {
    fail(
      `${path.relative(root, manifestPath)} not found; run npm run build first.`,
    );
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const strip = (file) => file.replace(/^\//, "");
  const entrypoints = (manifest.entrypoints || []).map(strip);
  const mainJs = manifest.files && manifest.files["main.js"];
  const mainCss = manifest.files && manifest.files["main.css"];
  if (!mainJs || !mainCss) {
    fail("asset-manifest.json has no main.js or main.css entry.");
  }
  const jsDir = "static/js";
  const allJs = fs
    .readdirSync(path.join(buildDir, jsDir))
    .filter((file) => file.endsWith(".js"))
    .map((file) => `${jsDir}/${file}`);
  return {
    mainJs: gzipBytes(strip(mainJs)),
    mainCss: gzipBytes(strip(mainCss)),
    initialJs: sum(entrypoints.filter((file) => file.endsWith(".js"))),
    allJs: sum(allJs),
  };
}

function kb(bytes) {
  // 1000-byte kB, matching the sizes CRA prints after a build.
  return `${(bytes / 1000).toFixed(2)} kB`;
}

function signedKb(bytes) {
  return `${bytes >= 0 ? "+" : "-"}${kb(Math.abs(bytes))}`;
}

function compare(current, baselines) {
  return metrics.map(({ key, label }) => {
    const ceiling = baselines && baselines.metrics && baselines.metrics[key];
    if (typeof ceiling !== "number") {
      return {
        key,
        label,
        bytes: current[key],
        ceiling: null,
        status: "no baseline",
      };
    }
    const delta = current[key] - ceiling;
    const over = current[key] > ceiling * (1 + tolerance);
    return {
      key,
      label,
      bytes: current[key],
      ceiling,
      delta,
      percent: (delta / ceiling) * 100,
      status: over ? "regressed" : "ok",
    };
  });
}

function summaryTable(rows) {
  const lines = [
    "### Bundle size (gzip -9)",
    "",
    "| Metric | Current | Ceiling | Change | Status |",
    "| --- | ---: | ---: | ---: | --- |",
  ];
  for (const row of rows) {
    const ceiling = row.ceiling === null ? "none" : kb(row.ceiling);
    const change =
      row.ceiling === null
        ? ""
        : `${signedKb(row.delta)} (${row.percent.toFixed(2)}%)`;
    lines.push(
      `| ${row.label} | ${kb(row.bytes)} | ${ceiling} | ${change} | ${row.status} |`,
    );
  }
  return `${lines.join("\n")}\n\nTolerance: ${tolerance * 100}% over each ceiling.\n`;
}

function main() {
  const args = new Set(process.argv.slice(2));
  const started = Date.now();
  const current = measure();

  if (args.has("--update")) {
    const baselines = {
      recorded: new Date().toISOString().slice(0, 10),
      node: process.version,
      metrics: current,
    };
    fs.writeFileSync(baselinesPath, `${JSON.stringify(baselines, null, 2)}\n`);
    print(`Wrote ${path.relative(root, baselinesPath)}:`);
    for (const { key, label } of metrics) {
      print(`  ${label.padEnd(32)} ${kb(current[key])}`);
    }
    return;
  }

  const baselines = fs.existsSync(baselinesPath)
    ? JSON.parse(fs.readFileSync(baselinesPath, "utf8"))
    : null;
  const rows = compare(current, baselines);
  const regressions = rows.filter((row) => row.status === "regressed");

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryTable(rows));
  }

  if (args.has("--json")) {
    print(
      JSON.stringify(
        {
          tolerance,
          ms: Date.now() - started,
          baseline: baselines && {
            recorded: baselines.recorded,
            node: baselines.node,
          },
          metrics: rows,
          passed: regressions.length === 0,
        },
        null,
        2,
      ),
    );
  } else {
    for (const row of rows) {
      const detail =
        row.ceiling === null
          ? "no baseline"
          : `ceiling ${kb(row.ceiling)}, ${signedKb(row.delta)} (${row.percent.toFixed(2)}%)`;
      const mark = row.status === "regressed" ? "FAIL" : "ok  ";
      print(
        `${mark} ${row.label.padEnd(32)} ${kb(row.bytes).padStart(12)}  ${detail}`,
      );
    }
  }

  if (regressions.length > 0) {
    console.error(
      `\nBundle size regressed more than ${tolerance * 100}% over its ceiling:`,
    );
    for (const row of regressions) {
      console.error(
        `  ${row.label}: ${kb(row.bytes)} vs ceiling ${kb(row.ceiling)} (${signedKb(row.delta)}, +${row.percent.toFixed(2)}%)`,
      );
    }
    console.error(
      "\nShrink the bundle, or if the growth is intended, run `npm run perf:bundle -- --update` and explain it in the PR.",
    );
    process.exit(1);
  }
}

main();
