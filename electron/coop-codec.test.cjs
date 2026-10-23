const { test } = require("node:test");
const assert = require("node:assert/strict");
const { RULE_LIMITS } = require("../src/helpers/ScenarioRulesSchema.js");
const { stringify, parse } = require("./coop-codec.cjs");

const digest = `sha256-${"a".repeat(64)}`;
const reference = () => ({ $electrifyScenario: digest });
const snapshot = () => ({
  id: 999,
  name: "Frozen rules",
  mod: {
    runtimeDigest: digest,
    source: { description: "Original description" },
  },
});
function world() {
  const scenario = snapshot();
  return {
    schema: 3,
    spec: { scenarioId: 999, customScenario: scenario },
    grids: Array.from({ length: 4 }, () => ({
      scenarioId: 999,
      customScenario: structuredClone(scenario),
      monthlyHistory: [{ year: 2020, month: 1, cash: 100 }],
      facilities: [{ derivedCost: Infinity }],
    })),
  };
}

test("native worlds losslessly share only exact frozen scenario copies, retaining detached decoded grids", () => {
  const source = world();
  const unchanged = structuredClone(source);
  const json = stringify(source);
  assert.deepEqual(
    JSON.parse(json).grids.map((g) => g.customScenario),
    Array.from({ length: 4 }, reference),
  );
  assert.deepEqual(source, unchanged);
  const decoded = parse(json);
  assert.deepEqual(decoded, source);
  assert.notEqual(decoded.grids[0].customScenario, decoded.spec.customScenario);
  assert.notEqual(
    decoded.grids[0].customScenario,
    decoded.grids[1].customScenario,
  );
  decoded.grids[0].customScenario.name = "Local edit";
  assert.equal(decoded.grids[1].customScenario.name, "Frozen rules");
});

test("a differing or missing grid snapshot is never repaired by a claimed matching digest", () => {
  const source = world();
  source.grids[0].customScenario.mod.source.description = "Edited content";
  source.grids[1].customScenario.mod.runtimeDigest = "b".repeat(64);
  delete source.grids[2].customScenario;
  const raw = JSON.parse(stringify(source));
  assert.equal(
    raw.grids[0].customScenario.mod.source.description,
    "Edited content",
  );
  assert.equal(raw.grids[1].customScenario.mod.runtimeDigest, "b".repeat(64));
  assert.equal(raw.grids[2].customScenario, undefined);
  assert.deepEqual(raw.grids[3].customScenario, reference());
  assert.deepEqual(parse(stringify(source)), source);
});

test("full JSON, official worlds, unknown world versions and nonfinite values retain their representation", () => {
  const full = world();
  full.grids.forEach((grid) => {
    grid.facilities = [];
  });
  assert.deepEqual(parse(JSON.stringify(full)), full);
  for (const source of [
    { ...full, schema: 4 },
    { ...full, spec: { scenarioId: 113 } },
    { schema: 3, spec: {}, grids: [{}, {}, {}, {}, {}] },
  ]) {
    assert.deepEqual(JSON.parse(stringify(source)), source);
    assert.deepEqual(parse(stringify(source)), source);
  }
  assert.deepEqual(
    parse(stringify({ values: [Infinity, -Infinity, NaN, -0] })).values,
    [Infinity, -Infinity, NaN, 0],
  );
});

test("nested native library and checkpoint-message containers expand before simulation validation", () => {
  for (const source of [
    { kind: "checkpoint", world: world() },
    { schema: 1, slots: [{ world: world() }] },
  ])
    assert.deepEqual(parse(stringify(source)), source);
});

test("edited references cannot claim another snapshot or carry hidden fields", () => {
  for (const edit of [
    (value) => {
      value.grids[0].customScenario.$electrifyScenario = "b".repeat(64);
    },
    (value) => {
      value.grids[0].customScenario.extra = true;
    },
    (value) => {
      value.grids[0].scenarioId = 113;
    },
    (value) => {
      delete value.spec.customScenario;
    },
    (value) => {
      value.spec.customScenario.mod.runtimeDigest = 123;
    },
  ]) {
    const encoded = JSON.parse(stringify(world()));
    edit(encoded);
    const before = structuredClone(encoded);
    assert.throws(
      () => parse(JSON.stringify(encoded)),
      /Invalid shared multiplayer scenario/,
    );
    assert.deepEqual(encoded, before);
  }
});

test("reference expansion enforces the current512KiB whole-snapshot budget at its exact byte boundary", () => {
  const source = world();
  source.spec.customScenario.mod.source.description = "";
  const bytes = Buffer.byteLength(JSON.stringify(source.spec.customScenario));
  source.spec.customScenario.mod.source.description = "x".repeat(
    RULE_LIMITS.compiledBytes - bytes,
  );
  source.grids.forEach((grid) => {
    grid.customScenario = reference();
  });
  assert.deepEqual(
    parse(JSON.stringify(source)).grids[0].customScenario,
    source.spec.customScenario,
  );
  source.spec.customScenario.mod.source.description += "x";
  assert.throws(() => parse(JSON.stringify(source)), /too large/);
  // The writer also refuses to create a reference for an oversized full snapshot.
  source.grids[0].customScenario = structuredClone(source.spec.customScenario);
  assert.deepEqual(
    JSON.parse(stringify(source)).grids[0].customScenario,
    source.grids[0].customScenario,
  );
});
