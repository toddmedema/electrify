import type { CompiledRuleObjective } from "../data/ScenarioRules";
import type {
  ObjectiveContext,
  ObjectiveMonthFacts,
} from "../data/ScenarioObjectives";
import { UTILITY_EXPANSION_OBJECTIVES } from "../data/UtilityExpansionObjectives";
import { EMPTY_HISTORY } from "./DateTime";
import {
  createObjectiveProgress,
  recordObjectiveMonth,
  evaluateScenarioObjectives,
  validObjectiveProgress,
  validObjectiveResult,
} from "./ScenarioObjectives";

const context: ObjectiveContext = {
  rulesDigest: "expansion-fixture",
  startingYear: 2005,
  seed: 12345,
  durationMonths: 240,
  ownership: "Investor",
  completedMonths: 0,
};
function observe(
  objective: CompiledRuleObjective,
  month: number,
  extra: Partial<ObjectiveMonthFacts>,
) {
  const progress = recordObjectiveMonth(
    createObjectiveProgress([objective], context, 90000),
    [objective],
    {
      month,
      history: {
        ...EMPTY_HISTORY,
        year: 2005 + Math.floor(month / 12),
        month: (month % 12) + 1,
      },
      ...extra,
    },
    context,
  );
  const atClose = { ...context, completedMonths: month + 1 };
  expect(validObjectiveProgress(progress, [objective], atClose)).toBe(true);
  const result = evaluateScenarioObjectives([objective], progress, atClose)[0];
  expect(validObjectiveResult(result)).toBe(true);
  return result;
}
const objective = (metric: CompiledRuleObjective["metric"]) =>
  UTILITY_EXPANSION_OBJECTIVES.find((value) => value.metric === metric)!;

test("a completed wire is not ownership; either acquired target meets December 2014", () => {
  const acquisition = objective("utilityOwnership");
  expect(observe(acquisition, 119, { ownedUtilities: [] }).status).toBe(
    "failed",
  );
  for (const target of ["valley-electric", "ridge-electric"])
    expect(observe(acquisition, 119, { ownedUtilities: [target] }).status).toBe(
      "completed",
    );
});

test("retirement tracks the original identity, allowing replacement oil backup", () => {
  const retirement = objective("assetRetirement");
  expect(
    observe(retirement, 191, {
      ownedAssetIds: ["scenario-116-champlain-oil-a"],
    }).status,
  ).toBe("failed");
  expect(
    observe(retirement, 191, { ownedAssetIds: ["replacement-oil"] }).status,
  ).toBe("completed");
});

test("cohort retention is judged only at December 2024 and fails on any lost cohort", () => {
  const retention = objective("cohortRetention");
  expect(observe(retention, 238, { minimumCohortRetention: 0.1 }).status).toBe(
    "pending",
  );
  expect(
    observe(retention, 239, { minimumCohortRetention: 0.899 }).status,
  ).toBe("failed");
  expect(observe(retention, 239, { minimumCohortRetention: 0.9 }).status).toBe(
    "completed",
  );
});

test("missing operating-area facts cannot silently satisfy a mission", () => {
  expect(observe(objective("utilityOwnership"), 119, {}).status).toBe(
    "unverifiable",
  );
  expect(observe(objective("cohortRetention"), 239, {}).status).toBe(
    "unverifiable",
  );
});
