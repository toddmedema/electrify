const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");

test("timing benchmarks retain their original sandbox and coverage floors", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/perf/jest-baseline.js", "--showConfig", "--watchAll=false"],
    { encoding: "utf8", maxBuffer: 2e6 },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const { configs, globalConfig } = JSON.parse(result.stdout);
  assert.deepEqual(configs[0].extraGlobals, ["Math"]);
  const { jest } = require("../../package.json");
  assert.deepEqual(globalConfig.coverageThreshold, jest.coverageThreshold);
  assert.deepEqual(globalConfig.collectCoverageFrom, jest.collectCoverageFrom);
  assert(jest.extraGlobals.includes("Number"));
  assert.match(configs[0].testEnvironment, /jest-environment-jsdom/);
  assert(
    Object.values(configs[0].transform)
      .flat()
      .some(
        (value) =>
          typeof value === "string" && value.includes("babelTransform"),
      ),
  );
});
