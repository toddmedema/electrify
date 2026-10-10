import manifest from "./data/RunCompatibility.json";
import { normalizedInputs } from "./helpers/RunIdentity";
import { isValidLocation } from "./helpers/Locations";

/** Save structure evolves independently of challenge/replay rules and app releases. */
export const SAVE_SCHEMA_VERSION = 1;
const RULES_ID = /^rules-\d+-[a-f0-9]{64}$/;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

// The unversioned save already has the current structure. Future structural
// changes add the next ordered migration here, without changing older steps.
const migrations = [
  (save: Record<string, unknown>): Record<string, unknown> => ({
    ...save,
    schemaVersion: 1,
  }),
];

/** Upgrade a copy; the caller still validates the entire resulting game. */
export function upgradeSave(raw: unknown): unknown {
  if (!object(raw)) return null;
  let save = raw;
  const version = save.schemaVersion === undefined ? 0 : save.schemaVersion;
  if (
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    version < 0 ||
    version > SAVE_SCHEMA_VERSION
  )
    return null;
  for (let step = version; step < SAVE_SCHEMA_VERSION; step++)
    save = migrations[step](save);
  if (!object(save.game)) return null;
  const game = save.game;
  if (game.upgradedFromRules !== undefined) {
    if (
      typeof game.upgradedFromRules !== "string" ||
      !RULES_ID.test(game.upgradedFromRules) ||
      game.runIdentity !== undefined ||
      game.challenge !== undefined ||
      game.replayLog !== undefined ||
      game.replayPlayback !== undefined
    )
      return null;
  }
  const identity = game.runIdentity;
  if (
    !object(identity) ||
    identity.compatibilityId === manifest.compatibilityId
  )
    return save;
  // An old rules digest is not proof that progress is corrupt. Check its link
  // to this game before removing claims of equivalent competitive conditions.
  if (
    typeof identity.compatibilityId !== "string" ||
    !RULES_ID.test(identity.compatibilityId) ||
    identity.origin !== "authored" ||
    identity.scenarioId !== game.scenarioId ||
    identity.seed !== game.seed ||
    !Number.isInteger(identity.seed) ||
    (identity.seed as number) < 0 ||
    (identity.seed as number) > 0xffffffff ||
    identity.difficulty !== game.difficulty ||
    !object(identity.inputs) ||
    typeof identity.inputs.scenario !== "string" ||
    !Array.isArray(identity.inputs.facilities) ||
    typeof identity.inputs.cash !== "number" ||
    !Number.isFinite(identity.inputs.cash) ||
    typeof identity.inputs.customers !== "number" ||
    !Number.isFinite(identity.inputs.customers) ||
    identity.inputs.customers <= 0 ||
    identity.inputs.meaningfulDecisionGateWaived !== false ||
    !isValidLocation(identity.inputs.location) ||
    normalizedInputs(identity.inputs.location) !==
      normalizedInputs(game.location) ||
    game.replayPlayback !== undefined ||
    game.meaningfulDecisionGateWaived ||
    game.storyEffectsDisabled ||
    game.customScenario
  )
    return null;
  if (game.challenge !== undefined) {
    const challenge = game.challenge;
    if (
      !object(challenge) ||
      Object.keys(challenge).sort().join() !== "run,target" ||
      !Number.isSafeInteger(challenge.target) ||
      !object(challenge.run) ||
      Object.keys(challenge.run).sort().join() !==
        "compatibilityId,difficulty,scenarioId,seed" ||
      ["scenarioId", "seed", "difficulty", "compatibilityId"].some(
        (key) =>
          (challenge.run as Record<string, unknown>)[key] !== identity[key],
      )
    )
      return null;
  }
  return {
    ...save,
    game: {
      ...game,
      upgradedFromRules: identity.compatibilityId,
      runIdentity: undefined,
      challenge: undefined,
      replayLog: undefined,
    },
  };
}
