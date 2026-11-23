const { createHash } = require("node:crypto");
const { canonicalRuleJson } = require("../../src/helpers/RuleIdentity");
const { loadSimData } = require("../../src/testing/SimData");
const { decodeWire } = require("../../src/multiplayer/WireJson");
const {
  hydrateWorld,
  matchScenario,
  RULES,
  savedMatchSpec,
} = require("../../src/multiplayer/World");
const { SAVE_SCHEMA_VERSION } = require("../../src/SaveSchema");

function validateCheckpoint(json) {
  const input = decodeWire(json);
  if (input?.rules !== RULES || input?.gameSchema !== SAVE_SCHEMA_VERSION)
    throw new Error("Incompatible multiplayer checkpoint");
  const spec = savedMatchSpec(input);
  const { location } = matchScenario(spec);
  loadSimData(location);
  hydrateWorld(input);
  const { matchId, epoch, revision, schema, gameSchema, rules, seats } = input;
  const scenarioDigest = createHash("sha256")
    .update(canonicalRuleJson(spec))
    .digest("hex");
  return {
    matchId,
    epoch,
    revision,
    schema,
    gameSchema,
    rules,
    seats: seats.map(({ id, name }) => ({ id, name })),
    activeSeatIds: seats
      .filter(({ id }) => !input.outcomes[id])
      .map(({ id }) => id),
    scenarioDigest,
  };
}

module.exports = { validateCheckpoint };
