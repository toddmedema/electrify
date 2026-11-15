const { RULE_LIMITS } = require("../src/helpers/ScenarioRulesSchema.js");

const REFERENCE = "$electrifyScenario";
const DIGEST = /^sha256-[a-f0-9]{64}$/;
const record = (value) =>
  value && typeof value === "object" && !Array.isArray(value);
const ARRAY_UNDEFINED = Symbol("array undefined");
function numberEncoding(_key, item) {
  if (typeof item === "number") {
    if (Object.is(item, -0)) return { $electrifyNumber: "-0" };
    if (!Number.isFinite(item)) return { $electrifyNumber: String(item) };
  }
  if (item === undefined && Array.isArray(this))
    return { $electrifyNumber: "undefined" };
  return item;
}
function numberDecoding(_key, item) {
  // Returning undefined from a JSON reviver deletes the array element. Restore it when the
  // containing array is visited instead, retaining an explicit undefined rather than a hole.
  if (Array.isArray(item))
    return item.map((value) => (value === ARRAY_UNDEFINED ? undefined : value));
  if (record(item) && Object.keys(item).length === 1) {
    if (item.$electrifyNumber === "undefined")
      return Array.isArray(this) ? ARRAY_UNDEFINED : undefined;
    if (["Infinity", "-Infinity", "NaN", "-0"].includes(item.$electrifyNumber))
      return Number(item.$electrifyNumber);
  }
  return item;
}
const plainJson = (value) => JSON.stringify(value, numberEncoding);

function worldShape(value) {
  return (
    record(value) &&
    value.schema === 3 &&
    record(value.spec) &&
    Array.isArray(value.grids) &&
    value.grids.length >= 2 &&
    value.grids.length <= 4
  );
}
function snapshotFor(world) {
  const snapshot = world.spec.customScenario;
  return world.spec.scenarioId === 999 &&
    record(snapshot) &&
    snapshot.id === 999 &&
    record(snapshot.mod) &&
    typeof snapshot.mod.runtimeDigest === "string" &&
    DIGEST.test(snapshot.mod.runtimeDigest)
    ? snapshot
    : undefined;
}

/** Lossless native encoding only: never discard a differing grid snapshot, even if its claimed
 * digest matches. In-memory worlds and their strict renderer validation keep the complete data. */
function packWorld(value) {
  if (!worldShape(value)) return value;
  const snapshot = snapshotFor(value);
  if (!snapshot) return value;
  const json = plainJson(snapshot);
  if (Buffer.byteLength(json) > RULE_LIMITS.compiledBytes) return value;
  const grids = value.grids.map((grid) =>
    record(grid) &&
    grid.scenarioId === 999 &&
    record(grid.customScenario) &&
    plainJson(grid.customScenario) === json
      ? { ...grid, customScenario: { [REFERENCE]: snapshot.mod.runtimeDigest } }
      : grid,
  );
  return { ...value, grids };
}

function unpackWorld(value) {
  if (!worldShape(value)) return value;
  const references = value.grids.filter(
    (grid) =>
      record(grid?.customScenario) &&
      Object.hasOwn(grid.customScenario, REFERENCE),
  );
  if (!references.length) return value;
  const snapshot = snapshotFor(value);
  if (!snapshot) throw new Error("Invalid shared multiplayer scenario");
  const json = plainJson(snapshot);
  if (Buffer.byteLength(json) > RULE_LIMITS.compiledBytes)
    throw new Error("Shared multiplayer scenario is too large");
  const grids = value.grids.map((grid) => {
    if (
      !record(grid?.customScenario) ||
      !Object.hasOwn(grid.customScenario, REFERENCE)
    )
      return grid;
    if (
      grid.scenarioId !== 999 ||
      Object.keys(grid.customScenario).length !== 1 ||
      grid.customScenario[REFERENCE] !== snapshot.mod.runtimeDigest
    )
      throw new Error("Invalid shared multiplayer scenario reference");
    // Preserve the prior detached-object semantics for callers that edit a company's local view.
    return { ...grid, customScenario: JSON.parse(json, numberDecoding) };
  });
  return { ...value, grids };
}

const stringify = (value) =>
  JSON.stringify(value, function (key, item) {
    return numberEncoding.call(this, key, packWorld(item));
  });
const parse = (value) =>
  JSON.parse(value, function (key, item) {
    return unpackWorld(numberDecoding.call(this, key, item));
  });

module.exports = { stringify, parse };
