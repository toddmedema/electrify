#!/usr/bin/env node
/**
 * Summarize why a pull request's CI failed, so an agent can fix it without reading raw logs.
 *
 *   npm run ci:failures                 latest Test Code run for this branch
 *   npm run ci:failures -- 561          latest run for pull request 561
 *   npm run ci:failures -- --run 39059574529
 *
 * Prints each failed job and step, the failing gates, tests and assertion messages, and how to
 * reproduce them locally. Exits 0 when the run passed, 1 when it failed, and 2 while it runs.
 */
const { execFileSync } = require("node:child_process");

const workflow = "Test Code";

function print(line = "") {
  process.stdout.write(`${line}\n`);
}

function gh(args) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
  });
}

// `gh run view --log-failed` prints "job<TAB>step<TAB>[timestamp ]text" per line.
function parseLine(line) {
  const [job, , ...rest] = line.split("\t");
  const text = rest
    .join("\t")
    .replace(/^﻿?\d{4}-\d\d-\d\dT[\d:.]+Z ?/, "")
    // eslint-disable-next-line no-control-regex -- strip ANSI colors from runner logs
    .replace(/\u001b\[[\d;]*m|\^\[\[[\d;]*m/g, "")
    .replace(/^##\[(notice|warning)\]/, "")
    .trimEnd();
  return { job, text };
}

function summarize(log) {
  const jobs = new Map();
  const entry = (job) => {
    if (!jobs.has(job))
      jobs.set(job, { gates: [], tests: [], flaky: [], errors: [] });
    return jobs.get(job);
  };
  const add = (list, value) => {
    if (!list.includes(value)) list.push(value);
  };
  // "failed" or "flaky" headings in a Playwright summary, followed by indented test titles.
  let section;
  let excerpt = 0;
  let previous;
  for (const line of log.split(/\r?\n/)) {
    if (!line.includes("\t")) continue;
    const { job, text } = parseLine(line);
    const found = entry(job);
    if (job !== previous) [previous, section, excerpt] = [job, undefined, 0];
    const trimmed = text.trim();
    const heading = /^\d+ (failed|flaky|skipped|passed|did not run)/.exec(
      trimmed,
    );
    if (heading) {
      [section, excerpt] = [heading[1], 0];
      continue;
    }
    if (section && /^(\[[\w-]+\] › )?e2e[\\/]\S+\.spec\.ts:\d+/.test(trimmed)) {
      const title = trimmed.replace(/\\/g, "/").replace(/ +$/, "");
      if (section === "failed") add(found.tests, title);
      if (section === "flaky") add(found.flaky, title);
      continue;
    }
    section = undefined;
    const gate = /^(.+): FAILED$/.exec(trimmed);
    if (gate) add(found.gates, gate[1]);
    else if (/^Network failure: /.test(trimmed)) add(found.errors, trimmed);
    // Jest prints "FAIL <suite>"; the bundle and benchmark gates print "FAIL <metric> ...".
    else if (
      /^[·.]*FAIL (src\/\S+\.(test|spec)\.\w+)(?: \([\d.]+ s\))?$/.test(trimmed)
    )
      add(found.tests, trimmed.match(/FAIL (\S+)/)[1]);
    else if (/^FAIL /.test(trimmed)) add(found.errors, trimmed);
    else if (/^(Shrink the bundle|Bundle size regressed)/.test(trimmed))
      add(found.errors, trimmed);
    else if (/^● (?!Console)/.test(trimmed)) add(found.tests, trimmed.slice(2));
    else if (/^✖ /.test(trimmed) && !/^✖ (failing tests|\d+)/.test(trimmed))
      add(found.tests, trimmed.slice(2));
    // Playwright repeats each failed title as "1) [project] › ..." above its error.
    if (/^\d+\) (\[|e2e)/.test(trimmed)) continue;
    if (
      /^(Error(?! Context)|TypeError|AssertionError)\b|^thrown:|^expect\(|(?:Test|Worker teardown) timeout|Timeout \d+ms exceeded/.test(
        trimmed,
      )
    )
      excerpt = 6;
    if (excerpt > 0 && trimmed && !trimmed.startsWith("##[error]")) {
      // A failed DOM matcher can print the entire application on one line.
      add(
        found.errors,
        trimmed.length > 500 ? trimmed.slice(0, 500) + "…" : trimmed,
      );
      excerpt--;
    }
    // Annotations repeat Playwright titles; keep only other runner errors, such as timeouts.
    const annotation = /^##\[error\]\s*(.*)$/.exec(trimmed);
    if (annotation && !/exit code \d+\.$|^\d+\) (\[|e2e)/.test(annotation[1]))
      add(found.errors, annotation[1]);
  }
  for (const [job, found] of jobs)
    if (!found.gates.length && !found.tests.length && !found.errors.length)
      jobs.delete(job);
  return jobs;
}

// Playwright titles look like "[mobile-390px] › e2e/x.spec.ts:12:5 › title"; configs with a
// single unnamed project omit the bracket.
function reproduce(tests) {
  const commands = new Set();
  const browserCommands = new Set();
  for (const test of tests) {
    if (/^src\/.*\.(test|spec)\.[jt]sx?$/.test(test)) {
      // Preserve instrumentation, coverage floors and suite interactions. An isolated
      // test:once pass is not evidence for a covered-unit failure.
      commands.add(
        `npm run check -- --steps ${test.includes(".sim.test.") ? "simulations" : "tests"}`,
      );
      continue;
    }
    const match = /^(?:\[([\w-]+)\] › )?(e2e\/[\w.-]+\.spec\.ts):(\d+)/.exec(
      test,
    );
    if (!match) continue;
    const [, project, spec, line] = match;
    if (project === "electron")
      commands.add(
        `${spec}:${line} runs only in CI (native windows); read its trace in the diagnostics artifact`,
      );
    else if (spec === "e2e/steam-input.spec.ts")
      commands.add("npm run check -- --steps steam-input");
    else if (["e2e/multiplayer.spec.ts", "e2e/mods.spec.ts"].includes(spec))
      commands.add("npm run check -- --steps multiplayer");
    else {
      browserCommands.add(
        `npm run test:e2e:production -- ${spec}:${line}${project ? ` --project=${project}` : ""}`,
      );
    }
  }
  // Desktop-renderer gates leave a desktop build in build/. Rebuild web after them,
  // regardless of the order in which the failed jobs/tests appeared in the log.
  return [
    ...commands,
    ...(browserCommands.size ? ["npm run build", ...browserCommands] : []),
  ];
}

function findRun(argv) {
  const runFlag = argv.indexOf("--run");
  if (runFlag >= 0) return argv[runFlag + 1];
  if (argv[0] && !/^\d+$/.test(argv[0]))
    throw new Error("Usage: npm run ci:failures -- [pr-number | --run <id>]");
  const branch = argv[0]
    ? gh([
        "pr",
        "view",
        argv[0],
        "--json",
        "headRefName",
        "--jq",
        ".headRefName",
      ]).trim()
    : execFileSync("git", ["branch", "--show-current"], {
        encoding: "utf8",
      }).trim();
  const id = gh([
    "run",
    "list",
    "--workflow",
    workflow,
    "--branch",
    branch,
    "--limit",
    "1",
    "--json",
    "databaseId",
    "--jq",
    ".[0].databaseId",
  ]).trim();
  if (!id) throw new Error(`No ${workflow} run found for ${branch}`);
  return id;
}

// Collapse viewport/platform and source-line changes, but retain each journey's file/title.
// Count a run once even when both native workers or several viewports hit the same defect.
function summarizeHistory(runs) {
  const totals = { success: 0, failure: 0, cancelled: 0, other: 0 };
  const tests = new Map();
  const gates = new Map();
  const unclassified = [];
  for (const run of runs) {
    totals[Object.hasOwn(totals, run.conclusion) ? run.conclusion : "other"]++;
    const seenGates = new Set();
    let identifiedTest = false;
    for (const found of run.summary?.values() || []) {
      for (const gate of found.gates) seenGates.add(gate);
      for (const [titles, flaky] of [
        [found.tests, false],
        [found.flaky, true],
      ]) {
        for (const title of titles) {
          const key = title
            .replace(/^\[[\w-]+\] › /, "")
            .replace(/:\d+(?::\d+)?(?= › |$)/, "");
          if (!/^(src|e2e)\//.test(key)) continue;
          identifiedTest = true;
          if (!tests.has(key))
            tests.set(key, {
              test: key,
              runs: new Set(),
              branches: new Set(),
              flakyRuns: new Set(),
              urls: new Set(),
            });
          const row = tests.get(key);
          row.runs.add(run.databaseId);
          row.branches.add(run.headBranch);
          row.urls.add(run.url);
          if (flaky) row.flakyRuns.add(run.databaseId);
        }
      }
    }
    for (const gate of seenGates) gates.set(gate, (gates.get(gate) || 0) + 1);
    if (
      run.conclusion === "failure" &&
      run.summary &&
      !seenGates.size &&
      !identifiedTest
    )
      unclassified.push(run.url);
  }
  return {
    totals,
    unclassified,
    gates: [...gates].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    tests: [...tests.values()]
      .map((row) => ({
        ...row,
        runs: row.runs.size,
        branches: row.branches.size,
        flakyRuns: row.flakyRuns.size,
        urls: [...row.urls],
      }))
      .sort((a, b) => b.runs - a.runs || a.test.localeCompare(b.test)),
  };
}

function history(limit = "100") {
  if (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 100)
    throw new Error("Usage: npm run ci:history -- [1-100]");
  const runs = JSON.parse(
    gh([
      "run",
      "list",
      "--workflow",
      workflow,
      "--event",
      "pull_request",
      "--limit",
      limit,
      "--json",
      "databaseId,headBranch,headSha,conclusion,url,createdAt",
    ]),
  );
  const unreadable = [];
  for (const run of runs) {
    if (run.conclusion !== "failure") continue;
    try {
      run.summary = summarize(
        gh(["run", "view", String(run.databaseId), "--log-failed"]),
      );
    } catch {
      unreadable.push(run.url);
    }
  }
  const result = summarizeHistory(runs);
  print(
    `Latest ${runs.length} PR workflow runs (latest attempt per run; gate counts overlap):`,
  );
  print(JSON.stringify(result.totals));
  print("\nFailed gates:");
  for (const [gate, count] of result.gates) print(`  ${count} runs: ${gate}`);
  print(
    "\nRecurring tests (failed runs / branches / runs with a passed retry):",
  );
  for (const row of result.tests) {
    print(`  ${row.runs} / ${row.branches} / ${row.flakyRuns}: ${row.test}`);
    for (const url of row.urls) print(`    ${url}`);
  }
  if (result.unclassified.length) {
    print(
      "\nFailed runs without a parsed test/gate (inspect their build/setup errors):",
    );
    result.unclassified.forEach((url) => print(`  ${url}`));
  }
  if (unreadable.length) {
    print(`\nUnreadable failure logs (${unreadable.length}; not classified):`);
    unreadable.forEach((url) => print(`  ${url}`));
    process.exitCode = 1;
  }
}

function main(argv = process.argv.slice(2)) {
  if (argv[0] === "--history") {
    if (argv.length > 2)
      throw new Error("Usage: npm run ci:history -- [1-100]");
    return history(argv[1]);
  }
  const id = findRun(argv);
  const run = JSON.parse(
    gh([
      "run",
      "view",
      id,
      "--json",
      "status,conclusion,headSha,headBranch,url,attempt,jobs",
    ]),
  );
  print(
    `${workflow} run ${id} (attempt ${run.attempt}) on ${run.headBranch} @ ${run.headSha.slice(0, 8)}: ${run.status}${run.conclusion ? ` / ${run.conclusion}` : ""}`,
  );
  print(run.url);
  try {
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    if (head !== run.headSha)
      print(
        `Note: local HEAD is ${head.slice(0, 8)}; this run tested a different commit.`,
      );
  } catch {
    // Not in a checkout; the summary still applies.
  }
  const failedJobs = run.jobs.filter((job) => job.conclusion === "failure");
  for (const job of failedJobs) {
    const steps = job.steps
      .filter((step) => step.conclusion === "failure")
      .map((step) => step.name);
    print(`\nFAILED ${job.name}: ${steps.join("; ") || "(no step)"}`);
  }
  if (run.status !== "completed") {
    const pending = run.jobs.filter((job) => job.status !== "completed");
    print(
      `\nStill running: ${pending.map((job) => job.name).join(", ")}. Wait with: gh run watch ${id} --exit-status`,
    );
    if (!failedJobs.length) process.exit(2);
  }
  if (run.conclusion === "success") return;
  if (!failedJobs.length) {
    print("\nNo failed jobs to report yet.");
    process.exitCode = run.status === "completed" ? 1 : 2;
    return;
  }
  // Failed logs are available only once the run, or that job, has finished.
  let log = "";
  try {
    log = gh(["run", "view", id, "--log-failed"]);
  } catch (error) {
    print(`\nCould not read failed logs yet: ${error.message.split("\n")[0]}`);
  }
  const summary = summarize(log);
  const allTests = [];
  for (const [job, found] of summary) {
    print(`\n== ${job}`);
    if (found.gates.length) print(`Failed gates: ${found.gates.join(", ")}`);
    for (const test of found.tests) print(`  ✘ ${test}`);
    for (const test of found.flaky)
      print(`  ~ flaky (passed on retry): ${test}`);
    for (const error of found.errors.slice(0, 24)) print(`    ${error}`);
    allTests.push(...found.tests, ...found.flaky);
  }
  const commands = reproduce(allTests);
  if (commands.length) {
    print("\nReproduce locally:");
    for (const command of commands) print(`  ${command}`);
  }
  print(
    "\nFull logs: gh run view " +
      id +
      " --log-failed. Fix the cause, run the matching local gate, push, and check again.",
  );
  process.exitCode = 1;
}

if (require.main === module)
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
module.exports = { summarize, reproduce, parseLine, summarizeHistory };
