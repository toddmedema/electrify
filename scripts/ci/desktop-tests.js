const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { parseShard, partition } = require("./jest-filter");
const durations = require("./desktop-durations.json");

const config = "e2e/desktop.playwright.config.ts";

function testDescriptions(report) {
  const descriptions = [];
  function walk(suite, parents) {
    for (const spec of suite.specs || [])
      for (const project of spec.tests)
        descriptions.push(
          `[${project.projectName}] › ${spec.file} › ${[...parents, spec.title].join(" › ")}`,
        );
    for (const child of suite.suites || [])
      walk(child, [...parents, child.title]);
  }
  for (const suite of report.suites) walk(suite, []);
  return descriptions.sort();
}

function discover(testList) {
  const result = spawnSync(
    process.execPath,
    [
      require.resolve("@playwright/test/cli"),
      "test",
      "--config",
      config,
      "--list",
      "--reporter=json",
      ...(testList ? ["--test-list", testList] : []),
    ],
    { encoding: "utf8", maxBuffer: 20e6 },
  );
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return testDescriptions(JSON.parse(result.stdout));
}

function plan(index, count, directory = `.tmp/native-plan-${index}`) {
  const all = discover();
  const selected = partition(all, count, durations)[index - 1];
  if (!selected?.length)
    throw new Error(`Empty native shard ${index}/${count}`);
  fs.mkdirSync(directory, { recursive: true });
  const list = path.resolve(directory, "native-test-list.txt");
  fs.writeFileSync(list, selected.join("\n") + "\n");
  // Playwright's test-list DSL matches title paths. Round-trip through its real loader to
  // reject ambiguous or stale selections rather than silently omitting or duplicating cases.
  if (JSON.stringify(discover(list)) !== JSON.stringify(selected))
    throw new Error(
      "Native test list did not select exactly the planned cases",
    );
  fs.writeFileSync(
    path.join(directory, "native-plan.json"),
    JSON.stringify({ index, count, all, selected }, null, 2) + "\n",
  );
  console.error(
    `Native shard ${index}/${count}: ${selected.length}/${all.length} cases`,
  );
  return list;
}

function main(value) {
  const { index, count } = parseShard(value);
  const list = plan(index, count);
  const result = spawnSync(
    process.execPath,
    [
      require.resolve("@playwright/test/cli"),
      "test",
      "--config",
      config,
      "--test-list",
      list,
      ...(process.argv.includes("--headed") ? ["--headed"] : []),
    ],
    { stdio: "inherit", env: { ...process.env, CI: "true" } },
  );
  fs.mkdirSync("test-results", { recursive: true });
  fs.copyFileSync(
    path.join(path.dirname(list), "native-plan.json"),
    "test-results/native-plan.json",
  );
  if (result.status === 0) {
    const expected = JSON.parse(
      fs.readFileSync("test-results/native-plan.json", "utf8"),
    ).selected;
    const actual = testDescriptions(
      JSON.parse(fs.readFileSync("test-results/desktop-results.json", "utf8")),
    );
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw new Error("Native run did not report its complete test assignment");
  }
  process.exitCode = result.status ?? 1;
}

if (require.main === module) main(process.argv[2]);
module.exports = { testDescriptions, discover, plan };
