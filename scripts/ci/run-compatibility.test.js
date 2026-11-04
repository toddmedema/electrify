const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const generator = path.resolve(__dirname, "../run-compatibility.js");

function fixture(t) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "electrify-compatibility-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, content) => {
    const filename = path.join(root, file);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, content);
  };
  for (const file of [
    "src/Constants.tsx",
    "src/Types.tsx",
    "src/data/ScenarioRules.ts",
    "src/data/OfficialRules.json",
    "src/helpers/ScenarioRulesCompiler.ts",
    "src/helpers/ScenarioRulesSchema.js",
    "src/helpers/RuleIdentity.js",
    "src/reducers/Game.tsx",
    "src/mods/ModSchema.js",
    "src/multiplayer/World.ts",
    "src/workers/Multiplayer.worker.ts",
    "electron/mods.cjs",
    "electron/steam-workshop.cjs",
    "electron/steam-multiplayer.cjs",
    "electron/coop-codec.cjs",
    "public/data/input.csv",
  ])
    write(file, "export const value = 1;\n");
  write("src/data/OfficialRules.json", '{"limit":1}\n');
  write("public/data/input.csv", "price\n10\n");
  write(
    "src/reducers/Game.tsx",
    `
import "../Constants";
import "../Types";
import "../data/ScenarioRules";
import "../data/OfficialRules.json";
import "../helpers/ScenarioRulesCompiler";
import "../helpers/ScenarioRulesSchema";
import "../helpers/RuleIdentity";
import "redux";
export const value = 1;
`,
  );
  const lock = {
    lockfileVersion: 3,
    packages: {
      "": {},
      "node_modules/redux": {
        version: "1",
        integrity: "sha512-first",
        dependencies: { immer: "1", "@types/redux": "1" },
      },
      "node_modules/immer": { version: "1", integrity: "sha512-first" },
      "node_modules/@types/redux": { version: "1", dev: true },
      "node_modules/prettier": { version: "1", dev: true },
    },
  };
  write("package-lock.json", JSON.stringify(lock));
  write("scripts/run-compatibility.js", fs.readFileSync(generator));
  const output = path.join(root, "src/data/RunCompatibility.json");
  const run = () =>
    spawnSync(
      process.execPath,
      [path.join(root, "scripts/run-compatibility.js")],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_PATH: path.resolve(__dirname, "../../node_modules"),
        },
      },
    );
  const manifest = () => {
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(fs.readFileSync(output, "utf8"));
  };
  return { root, write, run, manifest, output, lock };
}

for (const file of [
  "src/mods/ModSchema.js",
  "electron/mods.cjs",
  "electron/steam-workshop.cjs",
]) {
  test(`a package-only change in ${file} leaves official runs compatible`, (t) => {
    const f = fixture(t);
    const before = f.manifest();
    f.write(file, "changed package-only behavior\n");
    const after = f.manifest();
    assert.equal(after.compatibilityId, before.compatibilityId);
    assert.notEqual(after.modRuntimeId, before.modRuntimeId);
    assert.notEqual(
      after.multiplayerCompatibilityId,
      before.multiplayerCompatibilityId,
    );
  });
}

for (const file of [
  "src/helpers/ScenarioRulesCompiler.ts",
  "src/helpers/ScenarioRulesSchema.js",
  "src/helpers/RuleIdentity.js",
  "src/data/ScenarioRules.ts",
  "src/data/OfficialRules.json",
  "src/reducers/Game.tsx",
]) {
  test(`a shared-rule change in ${file} moves every runtime identity`, (t) => {
    const f = fixture(t);
    const before = f.manifest();
    f.write(
      file,
      file.endsWith(".json") ? '{"limit":2}\n' : "export const value = 2;\n",
    );
    const after = f.manifest();
    assert.notEqual(after.compatibilityId, before.compatibilityId);
    assert.notEqual(after.modRuntimeId, before.modRuntimeId);
    assert.notEqual(
      after.multiplayerCompatibilityId,
      before.multiplayerCompatibilityId,
    );
  });
}

for (const file of ["src/multiplayer/World.ts", "electron/coop-codec.cjs"])
  test(`transport changes in ${file} move only multiplayer compatibility`, (t) => {
    const f = fixture(t);
    const before = f.manifest();
    f.write(file, "changed co-op transport\n");
    const after = f.manifest();
    assert.equal(after.compatibilityId, before.compatibilityId);
    assert.equal(after.modRuntimeId, before.modRuntimeId);
    assert.notEqual(
      after.multiplayerCompatibilityId,
      before.multiplayerCompatibilityId,
    );
  });

test("UI and test files cannot churn runtime identities", (t) => {
  const f = fixture(t);
  const before = f.manifest();
  f.write("src/components/views/Rules.tsx", "changed presentation\n");
  f.write("src/helpers/ScenarioRules.test.ts", "changed shared-rule test\n");
  f.write("src/mods/ModSchema.test.ts", "changed parser test\n");
  assert.deepEqual(f.manifest(), before);
});

test("identities normalize source line endings and unchanged manifests are not rewritten", (t) => {
  const f = fixture(t);
  const before = f.manifest();
  assert.match(before.modRuntimeId, /^mod-2-[a-f0-9]{64}$/);
  f.write("src/helpers/ScenarioRulesSchema.js", "export const value = 1;\r\n");
  f.write("src/mods/ModSchema.js", "export const value = 1;\r\n");
  assert.deepEqual(f.manifest(), before);
  const previousTime = new Date("2000-01-01T00:00:00Z");
  fs.utimesSync(f.output, previousTime, previousTime);
  assert.deepEqual(f.manifest(), before);
  assert.equal(fs.statSync(f.output).mtimeMs, previousTime.getTime());
});

test("a mod parser containing an unfetched LFS pointer cannot receive a runtime identity", (t) => {
  const f = fixture(t);
  f.write(
    "src/mods/ModSchema.js",
    "version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 12\n",
  );
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /Fetch the actual input.*src\/mods\/ModSchema\.js/,
  );
});

test("types, comments, formatting and quote choice cannot split official runs", (t) => {
  const f = fixture(t);
  const before = f.manifest();
  f.write(
    "src/Types.tsx",
    "// a new UI shape\nexport interface Panel { name: string }\nexport const value: number = 1;\n",
  );
  f.write(
    "src/helpers/RuleIdentity.js",
    "/* explanation */ export const value=1;\n",
  );
  // A type-only dependency is erased and must not enter the graph (or need to exist at runtime).
  f.write(
    "src/helpers/ScenarioRulesCompiler.ts",
    'import type { NewType } from "./TypesOnly";\nexport const value: number = 1;\n',
  );
  const after = f.manifest();
  assert.equal(after.compatibilityId, before.compatibilityId);
  assert.equal(after.modRuntimeId, before.modRuntimeId);
  assert.notEqual(after.sourceId, before.sourceId);
  assert.notEqual(
    after.multiplayerCompatibilityId,
    before.multiplayerCompatibilityId,
  );
  f.write("src/helpers/RuleIdentity.js", 'export const value = "same";\n');
  const quoted = f.manifest();
  f.write("src/helpers/RuleIdentity.js", "export const value = 'same';\n");
  assert.equal(f.manifest().compatibilityId, quoted.compatibilityId);
});

test("unrelated helpers, reducers and dev dependencies leave official runs compatible", (t) => {
  const f = fixture(t);
  const before = f.manifest();
  f.write("src/helpers/NotUsedBySimulation.ts", "export const value = 2;\n");
  f.write("src/reducers/Ui.ts", "export const value = 2;\n");
  f.lock.packages["node_modules/prettier"].version = "2";
  f.lock.packages["node_modules/@types/redux"].version = "2";
  f.write("package-lock.json", JSON.stringify(f.lock));
  const after = f.manifest();
  assert.equal(after.compatibilityId, before.compatibilityId);
  assert.notEqual(after.sourceId, before.sourceId);
  assert.notEqual(
    after.multiplayerCompatibilityId,
    before.multiplayerCompatibilityId,
  );
});

test("new runtime imports, re-exports, require calls and directory entry points are covered", (t) => {
  const f = fixture(t);
  f.write(
    "src/helpers/ScenarioRulesCompiler.ts",
    'export { value } from "./NewDependency";\n',
  );
  f.write(
    "src/helpers/NewDependency/index.ts",
    'const nested = require("./nested"); export const value = nested.value;\n',
  );
  f.write("src/helpers/NewDependency/nested.js", "module.exports.value = 1;\n");
  const before = f.manifest();
  f.write("src/helpers/NewDependency/nested.js", "module.exports.value = 2;\n");
  assert.notEqual(f.manifest().compatibilityId, before.compatibilityId);
});

test("a new dependency outside the old simulation directories is covered", (t) => {
  const f = fixture(t);
  f.write(
    "src/helpers/ScenarioRulesCompiler.ts",
    'export { value } from "../simulation/Outside";\n',
  );
  f.write("src/simulation/Outside.ts", "export const value = 1;\n");
  const before = f.manifest();
  f.write("src/simulation/Outside.ts", "export const value = 2;\n");
  const after = f.manifest();
  assert.notEqual(after.compatibilityId, before.compatibilityId);
  assert.notEqual(after.sourceId, before.sourceId);
});

test("normalization preserves property access and string values", (t) => {
  const f = fixture(t);
  f.write(
    "src/helpers/RuleIdentity.js",
    'export const value = { first: "a", second: "b" }.first;\n',
  );
  const before = f.manifest();
  f.write(
    "src/helpers/RuleIdentity.js",
    'export const value = { first: "a", second: "b" }.second;\n',
  );
  const property = f.manifest();
  assert.notEqual(property.compatibilityId, before.compatibilityId);
  f.write(
    "src/helpers/RuleIdentity.js",
    'export const value = { first: "a", second: "c" }.second;\n',
  );
  assert.notEqual(f.manifest().compatibilityId, property.compatibilityId);
});

test("literal dynamic imports are covered and computed imports fail closed", (t) => {
  const f = fixture(t);
  f.write(
    "src/helpers/ScenarioRulesCompiler.ts",
    'export const load = () => import("./Dynamic");\n',
  );
  f.write("src/helpers/Dynamic.ts", "export const value = 1;\n");
  const before = f.manifest();
  f.write("src/helpers/Dynamic.ts", "export const value = 2;\n");
  assert.notEqual(f.manifest().compatibilityId, before.compatibilityId);
  f.write(
    "src/helpers/ScenarioRulesCompiler.ts",
    "export const load = (path: string) => import(path);\n",
  );
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Nonliteral simulation import/);
});

test("unresolved simulation imports fail closed", (t) => {
  const f = fixture(t);
  f.write(
    "src/helpers/ScenarioRulesCompiler.ts",
    'export { value } from "./NotPresent";\n',
  );
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unresolved simulation import/);
});

for (const specifier of [
  "../data/RunCompatibility.json",
  "../helpers/../data/RunCompatibility.json",
])
  test(`generated manifest import ${specifier} bootstraps without an existing output`, (t) => {
    const f = fixture(t);
    f.write(
      "src/helpers/ScenarioRulesCompiler.ts",
      `import manifest from "${specifier}"; export const value = manifest.compatibilityId;\n`,
    );
    assert.equal(fs.existsSync(f.output), false);
    const first = f.manifest();
    const bytes = fs.readFileSync(f.output, "utf8");
    assert.deepEqual(f.manifest(), first);
    assert.equal(fs.readFileSync(f.output, "utf8"), bytes);
    fs.rmSync(f.output);
    assert.deepEqual(f.manifest(), first);
    assert.equal(fs.readFileSync(f.output, "utf8"), bytes);
  });

test("a missing import beside the generated manifest still fails closed", (t) => {
  const f = fixture(t);
  f.write(
    "src/helpers/ScenarioRulesCompiler.ts",
    'import "../data/RunCompatibility-other.json"; export const value = 1;\n',
  );
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unresolved simulation import/);
});

test("only the audited scenario prompt components are presentation boundaries", (t) => {
  const f = fixture(t);
  f.write(
    "src/helpers/ScenarioRulesCompiler.ts",
    'import "../components/base/TutorialPrompt"; export const value = 1;\n',
  );
  f.write(
    "src/components/base/TutorialPrompt.tsx",
    "export const text = 'before';\n",
  );
  const before = f.manifest();
  f.write(
    "src/components/base/TutorialPrompt.tsx",
    "export const text = 'after';\n",
  );
  assert.equal(f.manifest().compatibilityId, before.compatibilityId);
  f.write(
    "src/helpers/ScenarioRulesCompiler.ts",
    'import "../components/NewRuntimeDependency"; export const value = 1;\n',
  );
  f.write(
    "src/components/NewRuntimeDependency.ts",
    "export const value = 1;\n",
  );
  const unknown = f.manifest();
  f.write(
    "src/components/NewRuntimeDependency.ts",
    "export const value = 2;\n",
  );
  assert.notEqual(f.manifest().compatibilityId, unknown.compatibilityId);
});

for (const dependency of ["redux", "immer"])
  test(`runtime dependency ${dependency} still changes official compatibility`, (t) => {
    const f = fixture(t);
    const before = f.manifest();
    f.lock.packages[`node_modules/${dependency}`].version = "2";
    f.write("package-lock.json", JSON.stringify(f.lock));
    assert.notEqual(f.manifest().compatibilityId, before.compatibilityId);
  });

test("shipped input bytes change compatibility and keep fetch-integrity metadata", (t) => {
  const f = fixture(t);
  const before = f.manifest();
  f.write("public/data/input.csv", "price\n20\n");
  const after = f.manifest();
  assert.notEqual(after.compatibilityId, before.compatibilityId);
  assert.notEqual(
    after.dataIntegrity["/data/input.csv"],
    before.dataIntegrity["/data/input.csv"],
  );
  f.write("public/data/input.csv", "price\r\n20\r\n");
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Normalize shipped data to LF/);
});
