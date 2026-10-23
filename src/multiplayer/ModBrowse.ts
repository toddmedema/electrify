import type { DifficultyType, ScenarioType } from "../Types";
import { scenarioObjectiveDefinitions } from "../helpers/ObjectiveRules";
import { objectiveDefinition } from "../helpers/ScenarioObjectives";
import {
  objectiveTargetText,
  objectiveWindowText,
} from "../helpers/ObjectivePresentation";
import { validScenarioMod } from "../helpers/ScenarioMod";
import { canonicalRuleJson, utf8Bytes } from "../helpers/RuleIdentity";
import {
  isRuleJson,
  RULE_SCENARIO_IDS,
  UNSAFE_MARKUP,
  UNSAFE_TEXT,
} from "../helpers/ScenarioRulesSchema";
import { DIFFICULTY_IDS } from "../Constants";

/** Safe facts only. Full definitions travel separately from the 16 KiB browse channel. */
export interface ModBrowseSummary {
  title: string;
  creator: string;
  version: string;
  baseScenarioId: number;
  durationMonths: number;
  startingYear: number;
  seed: number;
  difficulty: DifficultyType;
  packageDigest: string;
  runtimeDigest: string;
  objectives: {
    id: string;
    label: string;
    definition: string;
    target: string;
    window: string;
    required: boolean;
  }[];
}
export function modBrowseSummary(scenario: ScenarioType): ModBrowseSummary {
  const mod = scenario.mod!;
  return {
    title: mod.source.title,
    creator: mod.source.creator,
    version: mod.source.version,
    baseScenarioId: mod.parameters.baseScenarioId,
    durationMonths: scenario.durationMonths,
    startingYear: scenario.startingYear,
    seed: mod.parameters.seed,
    difficulty: mod.parameters.difficulty,
    packageDigest: mod.packageDigest,
    runtimeDigest: mod.runtimeDigest,
    objectives: scenarioObjectiveDefinitions(scenario).map((objective) => ({
      id: objective.id,
      label: objective.label,
      definition: objectiveDefinition(objective.metric),
      target: objectiveTargetText(objective),
      window: objectiveWindowText(
        objective,
        scenario.startingYear,
        scenario.durationMonths,
      ),
      required: objective.required !== false,
    })),
  };
}
const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: Record<string, unknown>, expected: string[]) =>
  Object.keys(v).length === expected.length &&
  expected.every((key) => Object.prototype.hasOwnProperty.call(v, key));
const text = (v: unknown, max: number) =>
  typeof v === "string" &&
  v.length > 0 &&
  v.length <= max &&
  !UNSAFE_TEXT.test(v) &&
  !UNSAFE_MARKUP.test(v);
const integer = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
const digest = (v: unknown) =>
  typeof v === "string" && /^sha256-[a-f0-9]{64}$/.test(v);
export function validModBrowseSummary(
  value: unknown,
): value is ModBrowseSummary {
  if (
    !isRuleJson(value) ||
    !plain(value) ||
    !keys(value, [
      "title",
      "creator",
      "version",
      "baseScenarioId",
      "durationMonths",
      "startingYear",
      "seed",
      "difficulty",
      "packageDigest",
      "runtimeDigest",
      "objectives",
    ])
  )
    return false;
  return (
    text(value.title, 100) &&
    text(value.creator, 100) &&
    text(value.version, 40) &&
    (value.baseScenarioId === 999 ||
      RULE_SCENARIO_IDS.includes(value.baseScenarioId as number)) &&
    integer(value.durationMonths, 6, 1200) &&
    integer(value.startingYear, 1980, 2100) &&
    integer(value.seed, 0, 4294967295) &&
    DIFFICULTY_IDS.includes(value.difficulty as DifficultyType) &&
    digest(value.packageDigest) &&
    digest(value.runtimeDigest) &&
    Array.isArray(value.objectives) &&
    value.objectives.length <= 16 &&
    value.objectives.every(
      (goal) =>
        plain(goal) &&
        keys(goal, [
          "id",
          "label",
          "definition",
          "target",
          "window",
          "required",
        ]) &&
        text(goal.id, 160) &&
        text(goal.label, 160) &&
        text(goal.definition, 500) &&
        text(goal.target, 600) &&
        text(goal.window, 100) &&
        typeof goal.required === "boolean",
    ) &&
    new Set(value.objectives.map((goal) => goal.id)).size ===
      value.objectives.length &&
    utf8Bytes(JSON.stringify(value)).length <= 15 * 1024
  );
}
/** The shared snapshot validator runs before its contents reach either a preview or Ready. */
export function validSelectedMod(
  summary: ModBrowseSummary,
  scenario: unknown,
): scenario is ScenarioType {
  if (
    !plain(scenario) ||
    !validScenarioMod(scenario.mod, scenario as unknown as ScenarioType)
  )
    return false;
  return (
    canonicalRuleJson(modBrowseSummary(scenario as unknown as ScenarioType)) ===
    canonicalRuleJson(summary)
  );
}
