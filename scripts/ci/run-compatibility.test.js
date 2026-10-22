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
    "package-lock.json",
    "public/data/input.csv",
  ])
    write(file, `${file}\n`);
  write("scripts/run-compatibility.js", fs.readFileSync(generator));
  const output = path.join(root, "src/data/RunCompatibility.json");
  const run = () =>
    spawnSync(
      process.execPath,
      [path.join(root, "scripts/run-compatibility.js")],
      {
        encoding: "utf8",
      },
    );
  const manifest = () => {
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(fs.readFileSync(output, "utf8"));
  };
  return { root, write, run, manifest, output };
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
    f.write(file, "changed shared rule\n");
    const after = f.manifest();
    assert.notEqual(after.compatibilityId, before.compatibilityId);
    assert.notEqual(after.modRuntimeId, before.modRuntimeId);
    assert.notEqual(
      after.multiplayerCompatibilityId,
      before.multiplayerCompatibilityId,
    );
  });
}

test("transport changes move only multiplayer compatibility", (t) => {
  const f = fixture(t);
  const before = f.manifest();
  f.write("src/multiplayer/World.ts", "changed co-op transport\n");
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
  assert.match(before.modRuntimeId, /^mod-1-[a-f0-9]{64}$/);
  f.write(
    "src/helpers/ScenarioRulesSchema.js",
    "src/helpers/ScenarioRulesSchema.js\r\n",
  );
  f.write("src/mods/ModSchema.js", "src/mods/ModSchema.js\r\n");
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
