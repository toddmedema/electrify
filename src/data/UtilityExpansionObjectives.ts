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
  {
    id: "retain-customers",
    label: "Retain 90% of your expanded customer base",
    metric: "customerRetention",
    minRetainedShare: 0.9,
    deadlineMonth: 239,
    required: true,
  },
];
