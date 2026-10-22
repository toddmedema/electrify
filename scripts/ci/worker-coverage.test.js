const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { globsToMatcher } = require("jest-util");
const { jest: config } = require("../../package.json");

test("Jest coverage excludes type declarations while retaining runtime TypeScript", () => {
  const root = path.resolve(__dirname, "../..");
  const covered = globsToMatcher(config.collectCoverageFrom);
  const declarations = fs
    .readdirSync(path.join(root, "src"), { recursive: true })
    .filter((file) => file.endsWith(".d.ts"));
  assert(declarations.length > 0, "No type declarations discovered");
  for (const file of declarations)
    assert.equal(
      covered(`src/${file.replace(/\\/g, "/")}`),
      false,
      `${file} has no runtime code to instrument`,
    );
  assert.equal(covered("src/mods/ModScenario.ts"), true);
});

test("Jest coverage excludes webpack-only worker constructors while retaining their clients", () => {
  const root = path.resolve(__dirname, "../..");
  const covered = globsToMatcher(config.collectCoverageFrom);
  const constructors = fs
    .readdirSync(path.join(root, "src"), { recursive: true })
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\./.test(file))
    .filter((file) => {
      const source = fs.readFileSync(path.join(root, "src", file), "utf8");
      return (
        /new\s+Worker\s*\(/.test(source) && source.includes("import.meta.url")
      );
    })
    .map((file) => `src/${file.replace(/\\/g, "/")}`);
  assert(constructors.length > 0, "No worker constructors discovered");
  for (const file of constructors)
    assert.equal(
      covered(file),
      false,
      `${file} cannot be instrumented by CommonJS Jest`,
    );
  assert.equal(covered("src/components/base/useOutlookWorker.ts"), true);
});
