const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const processResults = require("./jest-timings");
const { collectTimings, formatTimings } = processResults;

function temporary(t) {
  fs.mkdirSync(".tmp", { recursive: true });
  const directory = fs.mkdtempSync(path.resolve(".tmp/jest-timings-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function results(tests, success = true) {
  return {
    success,
    testResults: [
      {
        testFilePath: path.resolve("src/fixture.test.tsx"),
        testResults: tests,
      },
    ],
  };
}

test("timings preserve measured zero, slow and failed tests while unknown durations remain null", () => {
  const report = collectTimings(
    results(
      [
        { fullName: "slow", status: "passed", duration: 4500 },
        { fullName: "failure", status: "failed", duration: 5001 },
        { fullName: "zero", status: "passed", duration: 0 },
        { fullName: "skipped", status: "pending" },
        { fullName: "invalid", status: "failed", duration: -1 },
        { fullName: "nonfinite", status: "failed", duration: NaN },
      ],
      false,
    ),
  );
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.success, false);
  assert.deepEqual(
    report.tests.map(({ file, durationMs }) => [file, durationMs]),
    [4500, 5001, 0, null, null, null].map((duration) => [
      "src/fixture.test.tsx",
      duration,
    ]),
  );
  const summary = formatTimings(report);
  assert(summary.indexOf("5001 ms") < summary.indexOf("4500 ms"));
  assert.match(summary, /0 ms \| passed .* zero/);
  assert.match(summary, /3 durations unavailable/);
  assert.match(summary, /unknown duration \| failed .* invalid/);
});

test("summaries bound slow and failed lists independently without dropping complete artifact records", (t) => {
  const directory = temporary(t);
  const summaryFile = path.join(directory, "summary.md");
  const input = results([
    ...Array.from({ length: 14 }, (_, index) => ({
      fullName: `slow ${index} ${"x".repeat(1000)}`,
      status: "passed",
      duration: 1000 + index,
    })),
    ...Array.from({ length: 12 }, (_, index) => ({
      fullName: `failure ${index}\nwith | markdown`,
      status: "failed",
      duration: 0,
    })),
  ]);
  input.success = false;
  const logs = [];
  assert.equal(
    processResults(input, {
      directory,
      summaryFile,
      log: (line) => logs.push(line),
    }),
    input,
  );
  const report = JSON.parse(
    fs.readFileSync(path.join(directory, "timings.json")),
  );
  assert.equal(report.tests.length, 26);
  assert.equal(
    report.tests[0].fullName,
    input.testResults[0].testResults[0].fullName,
  );
  const summary = fs.readFileSync(summaryFile, "utf8");
  assert.equal(logs[0], summary);
  assert.equal(summary.match(/^- /gm).length, 20);
  assert.match(summary, /16 more; see timings.json/);
  assert.match(summary, /2 more; see timings.json/);
  assert.match(summary, /0 ms \| failed/);
  assert.match(summary, /with \\\| markdown/);
  assert(summary.length < 7000);
});

test("unavailable diagnostics preserve the original Jest result", (t) => {
  const directory = temporary(t);
  const file = path.join(directory, "file");
  fs.writeFileSync(file, "already a file");
  const input = results([]);
  const logs = [];
  assert.equal(
    processResults(input, { directory: file, log: (line) => logs.push(line) }),
    input,
  );
  assert.match(logs[0], /Jest timing diagnostics unavailable/);
  assert.equal(input.success, true);
});

test("the installed Jest hook retains raw durations, default reporting and a failed exit alongside ordinary JSON", (t) => {
  const directory = temporary(t);
  fs.writeFileSync(
    path.join(directory, "fixture.test.js"),
    `test("passed fixture", () => expect(true).toBe(true));
     test.skip("skipped fixture", () => {});
     test("failed fixture", () => expect(1).toBe(2));`,
  );
  const config = {
    rootDir: directory,
    testEnvironment: require.resolve("jest-environment-node"),
    testMatch: ["**/fixture.test.js"],
    testResultsProcessor: require.resolve("./jest-timings"),
  };
  const summaryFile = path.join(directory, "summary.md");
  const result = spawnSync(
    process.execPath,
    [
      require.resolve("jest/bin/jest"),
      `--config=${JSON.stringify(config)}`,
      "--runInBand",
      "--json",
      "--outputFile=results.json",
    ],
    {
      cwd: directory,
      encoding: "utf8",
      env: { ...process.env, CI: "true", GITHUB_STEP_SUMMARY: summaryFile },
    },
  );
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /FAIL .*fixture.test.js/);
  assert.match(result.stderr, /1 failed, 1 skipped, 1 passed/);
  const ordinary = JSON.parse(
    fs.readFileSync(path.join(directory, "results.json")),
  );
  const timings = JSON.parse(
    fs.readFileSync(
      path.join(directory, "test-results/jest-unit-1/timings.json"),
    ),
  );
  assert.equal(ordinary.success, false);
  assert.equal(timings.success, false);
  for (const test of timings.tests) {
    const assertion = ordinary.testResults[0].assertionResults.find(
      ({ fullName }) => fullName === test.fullName,
    );
    assert.equal(test.status, assertion.status);
    if (test.status === "pending") assert.equal(test.durationMs, null);
    else assert(Number.isFinite(test.durationMs) && test.durationMs >= 0);
  }
  assert.match(fs.readFileSync(summaryFile, "utf8"), /Failed tests/);
});
