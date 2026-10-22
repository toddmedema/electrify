import fs from "fs";
import path from "path";
import cloneDeep from "lodash.clonedeep";
import type { DifficultyType, ScenarioType } from "../Types";
import type { ModPackage } from "../mods/ModSchema";
import { canonicalRuleJson } from "../helpers/RuleIdentity";

const reference: {
  baselineCommit: string;
  scenarios: {
    difficulty: DifficultyType;
    pack: ModPackage;
    scenario: ScenarioType;
  }[];
} = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "fixtures/FrozenWildfireReference.json"),
    "utf8",
  ),
);
if (reference.baselineCommit !== "2fc5d50ebedd5d3695b9db7d75ca5b54c0912779")
  throw new Error("Unexpected frozen wildfire source.");

/** Literal old compiled scenarios, never reconstructed from today's catalog or edited in place. */
export function frozenWildfireScenario(
  input: ModPackage,
  difficulty: DifficultyType,
): ScenarioType {
  const captured = reference.scenarios.find(
    (entry) =>
      entry.difficulty === difficulty &&
      canonicalRuleJson(entry.pack) === canonicalRuleJson(input),
  );
  if (!captured)
    throw new Error(
      `Missing independently captured wildfire scenario for ${difficulty}.`,
    );
  return cloneDeep(captured.scenario);
}

export function frozenAutomaticWildfireScenario(): ScenarioType {
  const captured = reference.scenarios.find(
    (entry) =>
      entry.difficulty === "Employee" &&
      entry.pack.officialArcs?.some(
        (arc) => arc.scenarioId === 111 && !arc.includeChoices,
      ),
  );
  if (!captured)
    throw new Error(
      "Missing independently captured automatic wildfire scenario.",
    );
  return cloneDeep(captured.scenario);
}
