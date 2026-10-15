const fs = require("node:fs");
const path = require("node:path");
const { createCoverageMap } = require("istanbul-lib-coverage");
const { CoverageReporter } = require("@jest/reporters");
const { coverageThreshold } = require("../../package.json").jest;

function validateShards(manifests, count) {
  if (manifests.length !== count)
    throw new Error(`Expected ${count} shard manifests`);
  const expected = JSON.stringify(manifests[0].all);
  const seen = new Set();
  const indices = new Set();
  for (const manifest of manifests) {
    if (
      manifest.group !== "unit" ||
      manifest.count !== count ||
      manifest.index < 1 ||
      manifest.index > count ||
      indices.has(manifest.index) ||
      JSON.stringify(manifest.all) !== expected
    )
      throw new Error(
        "Unit shards disagree on the discovered suite or shard count",
      );
    indices.add(manifest.index);
    for (const file of manifest.selected) {
      if (seen.has(file))
        throw new Error(`Test suite ran in multiple shards: ${file}`);
      seen.add(file);
    }
  }
  if (
    seen.size !== manifests[0].all.length ||
    manifests[0].all.some((file) => !seen.has(file))
  )
    throw new Error("Unit shards did not cover every discovered test suite");
  return seen.size;
}

function normalizeCoverage(raw, root) {
  const normalized = {};
  for (const data of Object.values(raw)) {
    // Artifacts contain the producing checkout's absolute paths. Rebase only the source prefix
    // so the same merge works locally and in a different checkout, including Windows fixtures.
    const source = data.path.replace(/\\/g, "/");
    const marker = source.lastIndexOf("/src/");
    if (marker < 0) throw new Error(`Coverage outside src: ${source}`);
    const file = path.resolve(root, source.slice(marker + 1));
    normalized[file] = { ...data, path: file };
  }
  if (!Object.keys(normalized).length) throw new Error("Empty shard coverage");
  return normalized;
}

async function checkCoverage(
  coverage,
  root,
  directory,
  thresholds = coverageThreshold,
) {
  // Use the installed Jest reporter's public lifecycle, including its exact path/glob,
  // percentage and uncovered-count threshold semantics. Floors stay in package.json.
  const reporter = new CoverageReporter({
    rootDir: root,
    coverageDirectory: directory,
    coverageProvider: "babel",
    coverageReporters: ["json", "lcovonly", "text-summary"],
    coverageThreshold: thresholds,
  });
  reporter.onTestResult(undefined, { coverage });
  await reporter.onRunComplete(new Set(), {});
  const error = reporter.getLastError();
  if (error) throw error;
}

async function main(directory = "test-results", count = 3) {
  const root = process.cwd();
  const manifests = [];
  const map = createCoverageMap({});
  for (let index = 1; index <= count; index++) {
    const shard = path.join(directory, `jest-unit-${index}`);
    const read = (name) =>
      JSON.parse(fs.readFileSync(path.join(shard, name), "utf8"));
    const manifest = read("manifest.json");
    if (manifest.index !== index)
      throw new Error(`Incorrect artifact for shard ${index}`);
    manifests.push(manifest);
    const results = read("results.json");
    const executed = results.testResults
      .map((result) => {
        if (result.status !== "passed")
          throw new Error(`Suite did not pass: ${result.name}`);
        return result.name
          .replace(/\\/g, "/")
          .split("/src/")
          .slice(1)
          .join("/src/");
      })
      .map((file) => `src/${file}`)
      .sort();
    if (
      !results.success ||
      JSON.stringify(executed) !== JSON.stringify(manifest.selected)
    )
      throw new Error(
        `Shard ${index} did not execute its complete test assignment`,
      );
    map.merge(normalizeCoverage(read("coverage-final.json"), root));
  }
  const suites = validateShards(manifests, count);
  await checkCoverage(map.toJSON(), root, path.join(root, "coverage"));
  console.error(
    `Merged ${count} shards (${suites} suites); all existing coverage floors passed.`,
  );
}

if (require.main === module)
  main(process.argv[2], Number(process.argv[3] || 3)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
module.exports = { validateShards, normalizeCoverage, checkCoverage, main };
