import { SCENARIOS } from "../data/Scenarios";
import manifest from "../data/RunCompatibility.json";
import { getScenarioLocation, isValidLocation } from "./Locations";
import { getStartingCustomers } from "../data/LocationProfiles";
import { isValidDifficulty } from "./Difficulty";
import {
  AuthoredRunReference,
  RunIdentity,
  ScenarioType,
  DifficultyType,
  GameType,
} from "../Types";

/** Stable object keys, ordered arrays; functions are covered by the build manifest. */
export function normalizedInputs(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
}
export function captureRunIdentity(
  scenario: ScenarioType,
  seed: number,
  difficulty: DifficultyType,
  inputs?: Partial<RunIdentity["inputs"]>,
  origin: RunIdentity["origin"] = "authored",
): RunIdentity {
  const location = getScenarioLocation(scenario)!;
  return {
    scenarioId: scenario.id,
    // The manifest includes complete authored definitions, including function-valued rules.
    compatibilityId: manifest.compatibilityId,
    seed,
    difficulty,
    origin,
    inputs: {
      scenario: normalizedInputs(scenario),
      location,
      facilities: scenario.facilities,
      cash: scenario.cash,
      customers: scenario.startingCustomers || getStartingCustomers(location),
      meaningfulDecisionGateWaived: false,
      ...inputs,
    },
  };
}
export function sameRunIdentity(
  a: RunIdentity | undefined,
  b: RunIdentity | undefined,
): boolean {
  if (!a || !b) return false;
  const { origin: _a, ...left } = a;
  const { origin: _b, ...right } = b;
  return normalizedInputs(left) === normalizedInputs(right);
}
export function expandAuthoredRunReference(
  raw: unknown,
): RunIdentity | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  const r = raw as AuthoredRunReference;
  if (
    Object.keys(r).sort().join() !==
      ["scenarioId", "seed", "difficulty", "compatibilityId"].sort().join() ||
    r.compatibilityId !== manifest.compatibilityId ||
    !Number.isInteger(r.seed) ||
    r.seed < 0 ||
    r.seed > 0xffffffff ||
    !isValidDifficulty(r.difficulty)
  )
    return;
  const scenario = SCENARIOS.find(
    (s) => s.id === r.scenarioId && !s.tutorialSteps,
  );
  if (
    !scenario ||
    !getScenarioLocation(scenario) ||
    (scenario.seed !== undefined && scenario.seed !== r.seed)
  )
    return;
  return captureRunIdentity(scenario, r.seed, r.difficulty);
}
export function projectAuthoredRunReference(
  identity: RunIdentity | undefined,
): AuthoredRunReference | undefined {
  if (!identity || identity.origin !== "authored") return;
  const { scenarioId, seed, difficulty, compatibilityId } = identity;
  const reference: AuthoredRunReference = {
    scenarioId,
    seed,
    difficulty,
    compatibilityId,
  };
  return sameRunIdentity(identity, expandAuthoredRunReference(reference))
    ? reference
    : undefined;
}
/** Only canonical authored runs carry a shareable identity. */
export function validRunIdentity(raw: unknown): raw is RunIdentity {
  if (!raw || typeof raw !== "object") return false;
  return !!projectAuthoredRunReference(raw as RunIdentity);
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]): boolean =>
  Object.keys(value).sort().join() === keys.sort().join();

/**
 * A previous digest cannot establish competitive equivalence with this build. Validate its
 * self-contained authored setup and challenge linkage before retaining only playable progress.
 * Current-digest identities still pass the canonical validation below this import boundary.
 */
export function carrySavedRunForward<T extends Partial<GameType>>(
  game: T,
): T | null {
  if (
    (game.rulesChanged !== undefined &&
      typeof game.rulesChanged !== "boolean") ||
    (game.rulesChanged &&
      (game.runIdentity !== undefined || game.challenge !== undefined))
  )
    return null;
  const previous = game.runIdentity;
  if (previous === undefined) return game;
  if (!record(previous)) return null;
  if (previous.compatibilityId === manifest.compatibilityId) return game;
  try {
    if (
      !exactKeys(previous, [
        "scenarioId",
        "seed",
        "difficulty",
        "compatibilityId",
        "origin",
        "inputs",
      ]) ||
      typeof previous.compatibilityId !== "string" ||
      !/^rules-[1-9][0-9]*-[a-f0-9]{64}$/.test(previous.compatibilityId) ||
      previous.origin !== "authored" ||
      previous.scenarioId !== game.scenarioId ||
      previous.seed !== game.seed ||
      previous.difficulty !== game.difficulty ||
      game.meaningfulDecisionGateWaived ||
      game.storyEffectsDisabled ||
      game.customScenario ||
      !SCENARIOS.some(
        (scenario) =>
          scenario.id === previous.scenarioId && !scenario.tutorialSteps,
      )
    )
      return null;
    const inputs = previous.inputs;
    if (
      !record(inputs) ||
      !exactKeys(inputs, [
        "scenario",
        "location",
        "facilities",
        "cash",
        "customers",
        "meaningfulDecisionGateWaived",
      ]) ||
      typeof inputs.scenario !== "string" ||
      !isValidLocation(inputs.location) ||
      normalizedInputs(inputs.location) !== normalizedInputs(game.location) ||
      !Array.isArray(inputs.facilities) ||
      !inputs.facilities.every(record) ||
      typeof inputs.cash !== "number" ||
      !Number.isFinite(inputs.cash) ||
      typeof inputs.customers !== "number" ||
      !Number.isFinite(inputs.customers) ||
      inputs.customers <= 0 ||
      inputs.meaningfulDecisionGateWaived !== false
    )
      return null;
    const scenario: unknown = JSON.parse(inputs.scenario);
    if (
      !record(scenario) ||
      scenario.id !== previous.scenarioId ||
      scenario.tutorialSteps !== undefined ||
      scenario.startingYear !== game.startingYear ||
      (scenario.seed !== undefined && scenario.seed !== previous.seed) ||
      scenario.cash !== inputs.cash ||
      normalizedInputs(scenario.facilities) !==
        normalizedInputs(inputs.facilities) ||
      (scenario.location !== undefined
        ? normalizedInputs(scenario.location) !==
          normalizedInputs(inputs.location)
        : scenario.locationId !== inputs.location.id) ||
      (scenario.startingCustomers !== undefined &&
        (typeof scenario.startingCustomers !== "number" ||
          !Number.isFinite(scenario.startingCustomers) ||
          scenario.startingCustomers < 0 ||
          (scenario.startingCustomers > 0 &&
            scenario.startingCustomers !== inputs.customers)))
    )
      return null;
    if (game.challenge !== undefined) {
      const invitation = game.challenge;
      if (
        !record(invitation) ||
        !exactKeys(invitation, ["run", "target"]) ||
        !Number.isSafeInteger(invitation.target) ||
        !record(invitation.run) ||
        !exactKeys(invitation.run, [
          "scenarioId",
          "seed",
          "difficulty",
          "compatibilityId",
        ]) ||
        !(
          ["scenarioId", "seed", "difficulty", "compatibilityId"] as const
        ).every((key) => invitation.run[key] === previous[key])
      )
        return null;
    }
    return {
      ...game,
      runIdentity: undefined,
      challenge: undefined,
      rulesChanged: true,
    };
  } catch (_error) {
    return null;
  }
}
