#!/usr/bin/env node
/**
 * Extends weather files already present in public/data/weather without refetching their history.
 * With no --through argument, the last fully completed calendar year is used. The fetcher's usual
 * city ids and --limit option are also accepted, so rate-limited updates can resume safely.
 */
const path = require("path");
const { spawnSync } = require("child_process");

const args = process.argv.slice(2);
if (!args.includes("--through")) {
  args.push("--through", String(new Date().getFullYear() - 1));
}

const result = spawnSync(
  process.execPath,
  [path.join(__dirname, "fetch-weather.js"), "--update", ...args],
  { stdio: "inherit" },
);
if (result.error) throw result.error;
process.exitCode = result.status === null ? 1 : result.status;
