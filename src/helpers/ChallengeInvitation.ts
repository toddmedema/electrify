import { SCENARIOS } from "../data/Scenarios";
import type { ChallengeInvitation } from "../Types";
import { isValidDifficulty } from "./Difficulty";
import { getScenarioLocation } from "./Locations";

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function challengeScenario(scenarioId: unknown) {
  const scenario = SCENARIOS.find(
    (s) => s.id === scenarioId && !s.tutorialSteps,
  );
  return scenario && getScenarioLocation(scenario) ? scenario : undefined;
}

export function validInvitation(raw: unknown): raw is ChallengeInvitation {
  return (
    record(raw) &&
    Object.keys(raw).sort().join() === "difficulty,scenarioId,target" &&
    !!challengeScenario(raw.scenarioId) &&
    isValidDifficulty(raw.difficulty) &&
    Number.isSafeInteger(raw.target)
  );
}
