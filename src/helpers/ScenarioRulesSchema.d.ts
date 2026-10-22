import type { DifficultyType, FuelNameType } from "../Types";
import type {
  RuleDiagnostic,
  RuleReport,
  RuleObjective,
} from "../data/ScenarioRules";
export const RULE_DIFFICULTIES: readonly DifficultyType[];
export const RULE_FUELS: readonly FuelNameType[];
export const RULE_LIMITS: {
  events: number;
  choices: number;
  options: number;
  objectives: number;
  debriefReports: number;
  loadsPerEvent: number;
  compiledBytes: number;
};
export const ID_PATTERN: RegExp;
export const UNSAFE_TEXT: RegExp;
export const UNSAFE_MARKUP: RegExp;
export const REPORT_KINDS: readonly RuleReport["kind"][];
export const OBJECTIVE_METRICS: readonly RuleObjective["metric"][];
export function isRuleJson(value: unknown): boolean;
export function ruleDiagnostics(
  value: unknown,
  path?: string,
): RuleDiagnostic[];

export const FACILITY_NAMES: readonly import("../Types").ModFacilityNameType[];
export const FACILITY_MODIFIER_KEYS: readonly (keyof import("../Types").FacilityModifierType)[];
export const PROGRAM_KEYS: readonly ("efficiency" | "solar")[];
export const RULE_SCENARIO_IDS: readonly number[];
