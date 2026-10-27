// Diagnostic cold/restored transform comparison after the ordinary full covered suite passes.
const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");
const { acquireLease } = require("../dev/coordination");

async function main() {
  const lease = await acquireLease("heavy");
  let directory;
  try {
    await fs.mkdir(".tmp", { recursive: true });
    directory = await fs.mkdtemp(path.resolve(".tmp/jest-cache-bench-"));
    const samples = {
      coldMs: [],
      restoredMs: [],
      restoreMs: [],
      cacheBytes: [],
    };
    let expected;
    for (let round = 0; round < 3; round++) {
      const cache = path.join(directory, `cache-${round}`);
      const results = path.join(directory, "results.json");
      // Import-heavy behavioral suites isolate transform cost from long forecast computation.
      const args = [
        require.resolve("react-scripts/bin/react-scripts"),
        "test",
        "--watchAll=false",
        "--coverage",
        "--runTestsByPath",
        "src/reducers/ImportOrder.test.tsx",
        "src/SaveGame.test.tsx",
        "src/data/Facilities.test.tsx",
        "src/helpers/Financials.test.tsx",
        "--maxWorkers=4",
        `--cacheDirectory=${cache}`,
        "--coverageThreshold={}",
        "--coverageReporters=json",
        `--coverageDirectory=${path.join(directory, "coverage")}`,
        "--json",
        `--outputFile=${results}`,
      ];
      for (const mode of ["cold", "restored"]) {
        const start = performance.now();
        const output = await promisify(execFile)(process.execPath, args, {
          env: { ...process.env, CI: "true" },
          maxBuffer: 20e6,
          timeout: 600000,
          windowsHide: true,
        });
        samples[`${mode}Ms`].push(Math.round(performance.now() - start));
        const result = JSON.parse(await fs.readFile(results, "utf8"));
        assert(result.success && result.numFailedTests === 0);
        assert.equal(result.numTotalTestSuites, 4);
        const executed = result.testResults
          .map((suite) => ({
            name: suite.name,
            tests: suite.assertionResults.map(({ fullName, status }) => ({
              fullName,
              status,
            })),
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
        if (!expected) expected = executed;
        else assert.deepEqual(executed, expected);
        await fs.mkdir("test-results/ci-work-bench", { recursive: true });
        await fs.writeFile(
          `test-results/ci-work-bench/jest-${mode}-${round}.log`,
          output.stdout + output.stderr,
        );
        if (mode === "cold") {
          const archive = path.join(directory, `transforms-${round}.tar.gz`);
          await promisify(execFile)("tar", [
            "-czf",
            archive,
            "-C",
            directory,
            `cache-${round}`,
          ]);
          samples.cacheBytes.push((await fs.stat(archive)).size);
          await fs.rm(cache, { recursive: true });
          const restoreStart = performance.now();
          await promisify(execFile)("tar", ["-xzf", archive, "-C", directory]);
          samples.restoreMs.push(Math.round(performance.now() - restoreStart));
        }
      }
    }
    process.stdout.write(
      JSON.stringify(
        {
          suites: expected.length,
          tests: expected.reduce((sum, suite) => sum + suite.tests.length, 0),
          ...samples,
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    if (directory) await fs.rm(directory, { recursive: true, force: true });
    lease.release();
  }
}
if (require.main === module)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
