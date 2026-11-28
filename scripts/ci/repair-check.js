const { execFileSync, spawnSync } = require("node:child_process");
const { mkdirSync, mkdtempSync, readFileSync } = require("node:fs");
const path = require("node:path");
const { parseArgs } = require("node:util");
const { parseCheckArguments } = require("../check");

const webBuild = ".tmp/check-builds/web";
const desktopBuild = ".tmp/check-builds/desktop";
const web = { E2E_BUILD_DIR: webBuild };
const runners = {
  web: { script: "test:e2e:ci", build: "build", env: web },
  "web-all": {
    script: "test:e2e:production",
    build: "build",
    env: { ...web, ELECTRIFY_E2E_ALL_SPECS: "1" },
  },
  controller: {
    script: "test:steam-input",
    build: "desktop-build",
    env: { STEAM_INPUT_BUILD_DIR: desktopBuild },
  },
  multiplayer: {
    script: "test:multiplayer",
    build: "desktop-build",
    env: { MULTIPLAYER_BUILD_DIR: desktopBuild },
  },
  crossplay: {
    script: "test:crossplay",
    build: "desktop-build",
    env: { CROSSPLAY_BUILD_DIR: desktopBuild, CROSSPLAY_WEB_ONLY: "" },
  },
  "crossplay-web": {
    script: "test:crossplay",
    build: "build",
    env: { CROSSPLAY_BUILD_DIR: webBuild, CROSSPLAY_WEB_ONLY: "1" },
  },
};

const usage = `Usage: npm run check:repair -- --base <PR-base-ref>
       [--suite <Jest-test-file>] [--gate <check-step>]
       [--case '<runner>:<project>:<e2e/spec.ts>:<exact title>']
       [--simulation] [--full] [--resume]

Repeat --suite, --gate and --case as needed. Select at least one affected check.
Runners: ${Object.keys(runners).join(", ")}.`;

function parseRepairArguments(args) {
  const { values } = parseArgs({
    args,
    options: {
      base: { type: "string" },
      suite: { type: "string", multiple: true, default: [] },
      gate: { type: "string", multiple: true, default: [] },
      case: { type: "string", multiple: true, default: [] },
      simulation: { type: "boolean" },
      full: { type: "boolean" },
      resume: { type: "boolean" },
    },
  });
  if (
    !values.base?.trim() ||
    !(
      values.suite.length ||
      values.gate.length ||
      values.case.length ||
      values.full
    )
  )
    throw new Error(usage);
  for (const suite of values.suite) {
    if (!/^src\/[\w./-]+\.(test|spec)\.[jt]sx?$/.test(suite))
      throw new Error(`Use a Jest test file under src/ for --suite: ${suite}`);
  }
  const cases = values.case.map((selector) => {
    const match = /^([\w-]+):([\w-]+):(e2e\/[\w./-]+\.spec\.ts):(.+)$/.exec(
      selector,
    );
    if (!match || !Object.hasOwn(runners, match[1]))
      throw new Error(`Invalid browser case: ${selector}\n${usage}`);
    const [, runner, project, file, title] = match;
    return { runner, project, file, title };
  });
  const gates = [
    ...new Set([
      "types",
      "lint",
      "formatting",
      ...values.gate,
      ...cases.map(({ runner }) => runners[runner].build),
    ]),
  ];
  parseCheckArguments(["--steps", gates.join(",")]);
  return { ...values, cases, gates };
}

function reportedCases(suites) {
  return suites.flatMap((suite) => [
    ...suite.specs.flatMap((spec) =>
      spec.tests.map((test) => ({ spec, test })),
    ),
    ...reportedCases(suite.suites ?? []),
  ]);
}

function requireCase(report, wanted) {
  const cases = reportedCases(report.suites);
  const [{ spec, test } = {}] = cases;
  if (
    cases.length !== 1 ||
    `e2e/${spec.file}` !== wanted.file ||
    spec.title !== wanted.title ||
    test.projectName !== wanted.project
  )
    throw new Error(
      `Expected exactly one matching case for ${wanted.project} / ${wanted.file} / ${wanted.title}; selected ${cases.length}.`,
    );
  return test;
}

function requireFirstAttemptPass(report, wanted) {
  const test = requireCase(report, wanted);
  if (
    test.expectedStatus !== "passed" ||
    test.status !== "expected" ||
    test.results.length !== 1 ||
    test.results[0].retry !== 0 ||
    test.results[0].status !== "passed"
  )
    throw new Error(
      `The selected case did not pass on its first attempt: ${wanted.title}`,
    );
}

function print(message) {
  process.stdout.write(`${message}\n`);
}

function npm(script, args = [], env = {}) {
  print(
    `\n> npm run ${script}${args.length ? " -- " : ""}${args.map((arg) => JSON.stringify(arg)).join(" ")}`,
  );
  const result = spawnSync(
    process.execPath,
    [
      process.env.npm_execpath,
      "run",
      script,
      ...(args.length ? ["--", ...args] : []),
    ],
    {
      stdio: "inherit",
      env: { ...process.env, ...env },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${script} failed (${result.signal ?? result.status}).`);
}

function git(...args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  }).trim();
}

function cleanCandidate(baseRef) {
  if (git("status", "--porcelain", "--untracked-files=normal"))
    throw new Error(
      "Commit the repair and use a clean worktree before validating it.",
    );
  const head = git("rev-parse", "HEAD");
  const base = git(
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${baseRef}^{commit}`,
  );
  return { head, base };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function runBrowserCase(wanted, directory) {
  mkdirSync(directory);
  print(`\nChecking ${wanted.runner} / ${wanted.project} / ${wanted.title}`);
  const { script, env } = runners[wanted.runner];
  const selection = [
    `${escapeRegex(wanted.file)}$`,
    `--project=${wanted.project}`,
    `--grep=${escapeRegex(wanted.title)}`,
  ];
  const listReport = path.join(directory, "selection.json");
  const runReport = path.join(directory, "results.json");
  const browserEnv = { E2E_BASE_URL: "", ELECTRIFY_E2E_ALL_SPECS: "", ...env };
  npm(script, [...selection, "--list", "--reporter=json"], {
    ...browserEnv,
    PLAYWRIGHT_JSON_OUTPUT_FILE: listReport,
  });
  requireCase(JSON.parse(readFileSync(listReport, "utf8")), wanted);

  const reporter = wanted.runner.startsWith("web")
    ? "list,json,./e2e/expected-error.reporter.ts"
    : "list,json";
  npm(
    script,
    [
      ...selection,
      "--retries=0",
      "--workers=1",
      `--output=${path.join(directory, "artifacts")}`,
      `--reporter=${reporter}`,
    ],
    { ...browserEnv, PLAYWRIGHT_JSON_OUTPUT_FILE: runReport },
  );
  requireFirstAttemptPass(JSON.parse(readFileSync(runReport, "utf8")), wanted);
}

function main(args) {
  if (args.length === 1 && args[0] === "--help") {
    print(usage);
    return;
  }
  const options = parseRepairArguments(args);
  const { head, base } = cleanCandidate(options.base);
  print(`Repair candidate ${head}\nPR base ${options.base} at ${base}`);
  npm("check:prepush", [base]);
  const checkArgs = options.full ? [] : ["--steps", options.gates.join(",")];
  if (options.resume) checkArgs.push("--resume");
  npm("check:ci", checkArgs);
  if (options.suite.length)
    npm("test:once", ["--runTestsByPath", ...options.suite]);
  if (options.simulation) npm("sim", ["--all"]);
  if (options.cases.length) {
    const root = path.resolve(".tmp");
    mkdirSync(root, { recursive: true });
    const reports = mkdtempSync(path.join(root, "repair-"));
    print(`Browser evidence written to ${reports}`);
    for (const [index, wanted] of options.cases.entries())
      runBrowserCase(wanted, path.join(reports, String(index + 1)));
  }
  const current = cleanCandidate(options.base);
  if (current.head !== head || current.base !== base)
    throw new Error(
      "The candidate or PR base changed during validation. Rerun on the revision to be pushed.",
    );
  print(`\nRepair checks passed for ${head} against ${base}.`);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { parseRepairArguments, requireCase, requireFirstAttemptPass };
