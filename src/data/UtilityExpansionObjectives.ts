import type { CompiledRuleObjective } from "./ScenarioRules";

/** Authored obligations use original identities, never replacement plant fuel totals. */
export const UTILITY_EXPANSION_OBJECTIVES: CompiledRuleObjective[] = [
  {
    id: "acquire-neighbor",
    label: "Acquire Valley Electric or Ridge Electric",
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
    id: "retain-each-area",
    label: "Retain 90% of every operating area's customers",
    metric: "cohortRetention",
    minRetainedShare: 0.9,
    deadlineMonth: 239,
    required: true,
  },
];
