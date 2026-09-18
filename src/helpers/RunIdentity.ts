import { SCENARIOS } from "../data/Scenarios";
import manifest from "../data/RunCompatibility.json";
import { getScenarioLocation } from "./Locations";
import { getStartingCustomers } from "../data/LocationProfiles";
import { isValidDifficulty } from "./Difficulty";
import {
  AuthoredRunReferenceV1,
  RunIdentity,
  ScenarioType,
  DifficultyType,
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
    identitySchemaVersion: 1,
    scenarioId: scenario.id,
    // The manifest includes complete authored definitions, including function-valued rules.
    scenarioRevision: manifest.compatibilityId,
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
  const r = raw as AuthoredRunReferenceV1;
  if (
    Object.keys(r).sort().join() !==
      [
        "identitySchemaVersion",
        "scenarioId",
        "scenarioRevision",
        "seed",
        "difficulty",
        "compatibilityId",
        "optionsProfile",
      ]
        .sort()
        .join() ||
    r.identitySchemaVersion !== 1 ||
    r.optionsProfile !== "canonical-v1" ||
    r.compatibilityId !== manifest.compatibilityId ||
    r.scenarioRevision !== manifest.compatibilityId ||
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
): AuthoredRunReferenceV1 | undefined {
  if (!identity || identity.origin !== "authored") return;
  const {
    identitySchemaVersion,
    scenarioId,
    scenarioRevision,
    seed,
    difficulty,
    compatibilityId,
  } = identity;
  const reference: AuthoredRunReferenceV1 = {
    identitySchemaVersion,
    scenarioId,
    scenarioRevision,
    seed,
    difficulty,
    compatibilityId,
    optionsProfile: "canonical-v1",
  };
  return sameRunIdentity(identity, expandAuthoredRunReference(reference))
    ? reference
    : undefined;
}
/** Optional legacy metadata is absent, never inferred from current progress. */
export function validRunIdentity(raw: unknown): raw is RunIdentity {
  if (!raw || typeof raw !== "object") return false;
  return !!projectAuthoredRunReference(raw as RunIdentity);
}
