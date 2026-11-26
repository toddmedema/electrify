import { MUNICIPAL_UTILITIES } from "./MunicipalUtilities";
import { UTILITY_TARGETS } from "./UtilityExpansion";
import type { CompiledRuleObjective } from "./ScenarioRules";

export const UTILITY_EXPANSION_OBJECTIVES: CompiledRuleObjective[] = [
  {
    id: "acquire-neighbor",
    label: "Acquire 3 competitors",
    metric: "utilityOwnership",
    targets: [...UTILITY_TARGETS, ...MUNICIPAL_UTILITIES].map(({ id }) => id),
    minUtilities: 3,
    deadlineMonth: 119,
    required: true,
  },
];

// Rules published before Valley adopted a single objective.
export const VALLEY_TWO_GOAL_OBJECTIVES: CompiledRuleObjective[] = [
  ...UTILITY_EXPANSION_OBJECTIVES,
  {
    id: "retain-customers",
    label: "Retain 90% of your expanded customer base",
    metric: "customerRetention",
    minRetainedShare: 0.9,
    deadlineMonth: 239,
    required: true,
  },
];

/** The published Valley rules before acquisition goals replaced the oil deadlines. */
export const RETIRED_UTILITY_EXPANSION_OBJECTIVES: CompiledRuleObjective[] = [
  {
    id: "acquire-neighbor",
    label: "Acquire a competitor",
    metric: "utilityOwnership",
    targets: ["valley-electric", "ridge-electric"],
    deadlineMonth: 119,
    required: true,
  },
  {
    id: "retire-champlain-oil",
    label: "Retire Champlain's original Oil A",
    metric: "assetRetirement",
    assetIds: ["scenario-116-champlain-oil-a"],
    deadlineMonth: 191,
    required: true,
  },
  {
    id: "retire-acquired-oil",
    label: "Retire acquired original oil assets",
    metric: "assetRetirement",
    assetIds: ["scenario-116-valley-oil", "scenario-116-ridge-oil"],
    deadlineMonth: 227,
    required: true,
  },
  {
    id: "retain-customers",
    label: "Retain 90% of your expanded customer base",
    metric: "customerRetention",
    minRetainedShare: 0.9,
    deadlineMonth: 239,
    required: true,
  },
];
