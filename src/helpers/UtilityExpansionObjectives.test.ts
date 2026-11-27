import type { CompiledRuleObjective } from "../data/ScenarioRules";
import type {
  ObjectiveContext,
  ObjectiveMonthFacts,
} from "../data/ScenarioObjectives";
import {
  UTILITY_EXPANSION_OBJECTIVES,
  VALLEY_TWO_GOAL_OBJECTIVES,
} from "../data/UtilityExpansionObjectives";
import { EMPTY_HISTORY } from "./DateTime";
import {
  createObjectiveProgress,
  recordObjectiveMonth,
  evaluateScenarioObjectives,
  validObjectiveProgress,
  validObjectiveResult,
  rebaseObjectiveRetention,
} from "./ScenarioObjectives";

const context: ObjectiveContext = {
  rulesDigest: "expansion-fixture",
  startingYear: 2005,
  seed: 12345,
  durationMonths: 240,
  ownership: "Investor",
  completedMonths: 0,
  retentionAtDeadlineOnly: true,
};
function observe(
  objective: CompiledRuleObjective,
  month: number,
  extra: Partial<ObjectiveMonthFacts>,
  baseline = 90000,
  customers = baseline,
) {
  const progress = recordObjectiveMonth(
    createObjectiveProgress([objective], context, baseline),
    [objective],
    {
      month,
      history: {
        ...EMPTY_HISTORY,
        year: 2005 + Math.floor(month / 12),
        month: (month % 12) + 1,
        customers,
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
  VALLEY_TWO_GOAL_OBJECTIVES.find((value) => value.metric === metric)!;

test("three distinct eligible sellers satisfy the acquisition deadline", () => {
  const acquisition = objective("utilityOwnership");
  expect(
    observe(acquisition, 119, {
      ownedUtilities: [
        "valley-electric",
        "parcel-1",
        "parcel-1",
        "green-uplands",
      ],
    }),
  ).toMatchObject({ status: "failed", observed: 2, target: 3 });
  expect(
    observe(acquisition, 119, {
      ownedUtilities: ["valley-electric", "parcel-1", "parcel-11"],
    }),
  ).toMatchObject({ status: "completed", observed: 3, target: 3 });
});

test("the retired aggregate retention goal was judged only in December 2024", () => {
  const retention = objective("customerRetention");
  const baseline = 90000 + 179112 + 56324;
  expect(observe(retention, 238, {}, baseline, 1).status).toBe("pending");
  expect(observe(retention, 239, {}, baseline, baseline * 0.9 - 1).status).toBe(
    "failed",
  );
  expect(observe(retention, 239, {}, baseline, baseline * 0.9).status).toBe(
    "completed",
  );
});

test("missing ownership or invalid total customers cannot silently satisfy a mission", () => {
  expect(observe(objective("utilityOwnership"), 119, {}).status).toBe(
    "unverifiable",
  );
  expect(
    observe(objective("customerRetention"), 239, {}, 90000, NaN).status,
  ).toBe("unverifiable");
});

test("rebasing acquisition evidence preserves facts and renews all consistency chains", () => {
  const ownership = objective("utilityOwnership");
  const atClose = { ...context, completedMonths: 120 };
  const original = recordObjectiveMonth(
    createObjectiveProgress(UTILITY_EXPANSION_OBJECTIVES, context, 90000),
    UTILITY_EXPANSION_OBJECTIVES,
    {
      month: 119,
      history: { ...EMPTY_HISTORY, year: 2014, month: 12, customers: 270000 },
      ownedUtilities: ["valley-electric"],
    },
    context,
  );
  expect(
    validObjectiveProgress(original, UTILITY_EXPANSION_OBJECTIVES, atClose),
  ).toBe(true);
  expect(
    validObjectiveProgress(
      { ...original, retentionBaseline: 269112 },
      UTILITY_EXPANSION_OBJECTIVES,
      atClose,
    ),
  ).toBe(false);
  const rebased = rebaseObjectiveRetention(
    original,
    UTILITY_EXPANSION_OBJECTIVES,
    atClose,
    269112,
  );
  expect(
    validObjectiveProgress(rebased, UTILITY_EXPANSION_OBJECTIVES, atClose),
  ).toBe(true);
  expect(
    rebased.entries.find(({ id }) => id === ownership.id)!.observations,
  ).toEqual(
    original.entries.find(({ id }) => id === ownership.id)!.observations,
  );
  expect(rebased.completedMonths).toBe(original.completedMonths);
  expect(rebased.retentionBaseline).toBe(269112);
  expect(
    evaluateScenarioObjectives(UTILITY_EXPANSION_OBJECTIVES, rebased, atClose),
  ).toEqual([
    expect.objectContaining({ metric: "utilityOwnership", observed: 1 }),
  ]);
});
