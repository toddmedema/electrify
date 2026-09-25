#!/usr/bin/env node
/**
 * Rewrites every performance ratchet in one visible diff: the golden output snapshot (B2), the
 * tick bench ratio ceilings (B1/B7) and, when a production build exists, the bundle size ceilings
 * (B5). The browser census (B3/B4) needs a dev server, so it is rebaselined separately with
 * PERF_UPDATE=1. See docs/perf-plan.md. Run it last.
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");

function run(label, command, args, env = {}) {
  console.error(`\n== ${label}`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...env },
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    console.error(`${label} failed`);
    process.exit(result.status || 1);
  }
}

run(
  "Golden outputs",
  "npx",
  ["react-scripts", "test", "--watchAll=false", "GoldenOutputs", "-u"],
  { CI: "true" },
);
run("Tick bench", "node", ["scripts/perf/bench.js", "--update"]);
if (fs.existsSync(path.join(root, "build", "asset-manifest.json"))) {
  run("Bundle size", "node", ["scripts/perf/bundle-size.js", "--update"]);
} else {
  console.error(
    "\n== Bundle size skipped: run npm run build first to rebaseline it",
  );
}
console.error(
  "\nBrowser census: PERF_UPDATE=1 npm run test:e2e -- perf-census.spec.ts --project=desktop-chromium --project=mobile-390px",
);
