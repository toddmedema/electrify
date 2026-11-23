import { SCENARIOS } from "../data/Scenarios";
import type { AuthoredRunReference, ChallengeInvitation } from "../Types";
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

export function readLegacyInvitation(
  raw: unknown,
): { run: AuthoredRunReference; target: number } | undefined {
  if (!record(raw) || Object.keys(raw).sort().join() !== "run,target") return;
  const { run, target } = raw;
  if (
    !record(run) ||
    Object.keys(run).sort().join() !==
      "compatibilityId,difficulty,scenarioId,seed" ||
    typeof run.scenarioId !== "number" ||
    !isValidDifficulty(run.difficulty) ||
    typeof run.seed !== "number" ||
    !Number.isInteger(run.seed) ||
    run.seed < 0 ||
    run.seed > 0xffffffff ||
    typeof run.compatibilityId !== "string" ||
    !/^rules-[1-9][0-9]*-[a-f0-9]{64}$/.test(run.compatibilityId) ||
    typeof target !== "number" ||
    !Number.isSafeInteger(target)
  )
    return;
  const { scenarioId, difficulty, seed, compatibilityId } = run;
  return { run: { scenarioId, difficulty, seed, compatibilityId }, target };
}
