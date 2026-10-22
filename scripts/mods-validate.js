#!/usr/bin/env node
/** Uses the game's existing TS/JSX runner; a private result file keeps --json stdout clean. */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const USAGE = `Validate a scenario package using the game's parser and compiler.

  npm run mods:validate -- scenario.json
  npm run mods:validate -- scenario.json --explain
  npm run mods:validate -- scenario.json --json

  --json       Print one JSON report; errors exit 1, warnings exit 0
  --explain    Include all difficulty facts, month timelines, ranges and replace-ready goals
  --help       Show this help
`;

function parseValidationArguments(args) {
  const options = { json: false, explain: false };
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") return { ...options, help: true };
    if (arg === "--json") options.json = true;
    else if (arg === "--explain") options.explain = true;
    else if (arg.startsWith("-")) throw new Error(`Unknown option ${arg}`);
    else if (options.file)
      throw new Error("Choose exactly one scenario JSON file.");
    else options.file = path.resolve(arg);
  }
  if (!options.file) throw new Error("A scenario JSON file is required.");
  return options;
}

function main(args = process.argv.slice(2)) {
  let options;
  try {
    options = parseValidationArguments(args);
  } catch (error) {
    process.stderr.write(`${error.message}\n${USAGE}`);
    return 1;
  }
  if (options.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "electrify-mod-validate-"),
  );
  const resultFile = path.join(directory, "result.json");
  try {
    const result = spawnSync(
      process.execPath,
      [
        require.resolve("react-scripts/bin/react-scripts.js", {
          paths: [path.resolve(__dirname, "..")],
        }),
        "test",
        "--watchAll=false",
        "--runInBand",
        "--cacheDirectory=.tmp/jest-mod-validate",
        "--testMatch",
        "**/src/testing/ModsValidateCli.tsx",
      ],
      {
        cwd: path.resolve(__dirname, ".."),
        encoding: "utf8",
        env: {
          ...process.env,
          CI: "true",
          MODS_VALIDATE_INPUT: options.file,
          MODS_VALIDATE_RESULT: resultFile,
          MODS_VALIDATE_EXPLAIN: options.explain ? "1" : "0",
        },
      },
    );
    if (result.status !== 0 || !fs.existsSync(resultFile)) {
      process.stderr.write(
        result.error?.message ||
          result.stderr ||
          result.stdout ||
          "The scenario validator could not start.\n",
      );
      return 1;
    }
    const { report, text } = JSON.parse(fs.readFileSync(resultFile, "utf8"));
    process.stdout.write(
      `${options.json ? JSON.stringify(report, null, 2) : text}\n`,
    );
    return report.valid &&
      !report.diagnostics.some((diagnostic) => diagnostic.severity === "error")
      ? 0
      : 1;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
if (require.main === module) process.exit(main());
module.exports = { parseValidationArguments };
