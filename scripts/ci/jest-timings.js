const fs = require("node:fs");
const path = require("node:path");

function collectTimings(results, root = process.cwd()) {
  return {
    schemaVersion: 1,
    success: results.success,
    tests: results.testResults.flatMap((suite) =>
      suite.testResults.map((test) => ({
        file: path.relative(root, suite.testFilePath).split(path.sep).join("/"),
        fullName: test.fullName,
        status: test.status,
        // Skipped tests and failures before execution may have no duration; zero is valid.
        durationMs:
          Number.isFinite(test.duration) && test.duration >= 0
            ? test.duration
            : null,
      })),
    ),
  };
}

function formatTimings(report) {
  const limit = 10;
  const slowestFirst = (a, b) =>
    (b.durationMs ?? -1) - (a.durationMs ?? -1) ||
    a.file.localeCompare(b.file) ||
    a.fullName.localeCompare(b.fullName);
  // Keep logs and the job summary bounded even when a generated test has a huge title.
  const label = (value) =>
    value
      .replace(/\s+/g, " ")
      .slice(0, 200)
      .replace(/[\\`*_[\]<>|]/g, "\\$&");
  const section = (title, tests) =>
    `### ${title}\n\n` +
    (tests.length
      ? tests
          .slice(0, limit)
          .map(
            (test) =>
              `- ${test.durationMs === null ? "unknown duration" : `${Math.round(test.durationMs)} ms`} | ${test.status} | ${label(test.file)} | ${label(test.fullName)}\n`,
          )
          .join("")
      : "None.\n") +
    (tests.length > limit
      ? `${tests.length - limit} more; see timings.json.\n`
      : "") +
    "\n";
  const measured = report.tests
    .filter((test) => test.durationMs !== null)
    .sort(slowestFirst);
  const failed = report.tests
    .filter((test) => test.status === "failed")
    .sort(slowestFirst);
  return (
    `## Covered unit test timings\n\n${report.tests.length} tests; ${report.tests.length - measured.length} durations unavailable. Complete results: jest-unit-1/timings.json.\n\n` +
    section("Slowest tests (up to 10)", measured) +
    section("Failed tests (up to 10)", failed)
  );
}

// Jest 27's --json formatter drops individual assertion durations. Its supported results
// processor receives them first; retain them beside results.json without changing that report.
function processResults(
  results,
  {
    directory = "test-results/jest-unit-1",
    summaryFile = process.env.GITHUB_STEP_SUMMARY,
    log = console.error,
  } = {},
) {
  try {
    const report = collectTimings(results);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, "timings.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    const summary = formatTimings(report);
    log(summary);
    if (summaryFile) fs.appendFileSync(summaryFile, summary);
  } catch (error) {
    // Diagnostics are observational: their availability cannot change the test outcome.
    log(`Jest timing diagnostics unavailable: ${error.message.split("\n")[0]}`);
  }
  return results;
}

module.exports = processResults;
module.exports.collectTimings = collectTimings;
module.exports.formatTimings = formatTimings;
