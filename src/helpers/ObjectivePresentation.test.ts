import { UTILITY_EXPANSION_OBJECTIVES } from "../data/UtilityExpansionObjectives";
import type { CompiledRuleObjective } from "../data/ScenarioRules";
import type { ObjectiveResult } from "../data/ScenarioObjectives";
import { objectiveDefinition } from "./ScenarioObjectives";
import {
  finishedObjectiveStatusText,
  objectiveObservedText,
  objectiveTargetText,
  objectiveValueText,
  objectiveWindowText,
  objectiveDefinitionText,
  objectiveGoalGroups,
} from "./ObjectivePresentation";

const localShare: CompiledRuleObjective = {
  id: "localShare",
  label: "Deliver local wind",
  fuels: ["Wind"],
  required: true,
  metric: "localFuelShare",
  fromMonth: 12,
  throughMonth: 23,
  minShare: 0.995,
};
const result = (changes: Partial<ObjectiveResult> = {}): ObjectiveResult => ({
  objective: localShare,
  id: localShare.id,
  metric: localShare.metric,
  label: localShare.label,
  required: true,
  definition: objectiveDefinition(localShare.metric),
  status: "inProgress",
  target: 0.995,
  observedMonths: 1,
  requiredMonths: 12,
  ...changes,
});

it.each([
  [1679225, "1.68M"],
  [123456, "123k"],
  [2678123456, "2.68B"],
  [0.000123456, "0.000123"],
  [999999, "1M"],
  [999499, "999k"],
])(
  "compact goals show at most three significant digits for %s",
  (value, text) => {
    expect(
      objectiveValueText(
        {
          id: "debt",
          label: "Debt",
          required: true,
          metric: "monthEndDebt",
          fromMonth: 0,
          throughMonth: 11,
          maxDebt: value,
        },
        value,
      ),
    ).toBe(`$${text}`);
  },
);

it("uses concise emissions copy and whole-year ranges without changing the measurement", () => {
  const objective: CompiledRuleObjective = {
    id: "intensity",
    label: "Footprint",
    required: true,
    metric: "emissionsPerDeliveredMWh",
    fromMonth: 204,
    throughMonth: 239,
    maxKgCO2ePerMWh: 350,
  };
  expect(objectiveTargetText(objective)).toBe("≤350 kg CO₂e/MWh");
  expect(objectiveWindowText(objective, 2002, 240)).toBe("2019–2021");
  expect(
    objectiveDefinitionText({
      metric: objective.metric,
      definition: objectiveDefinition(objective.metric),
    }),
  ).toBe("Emissions, including imports, exports and construction, per MWh.");
});

it("retains the actual side of an arbitrarily close share target", () => {
  expect(objectiveValueText(localShare, 0.99999999999999, 1)).not.toBe("100%");
  expect(objectiveValueText(localShare, 0.99500000000001, 0.995)).not.toBe(
    "99.5%",
  );
  expect(objectiveValueText(localShare, 0.995)).toBe("99.5%");
  expect(objectiveTargetText({ ...localShare, minShare: 0.9999999 })).toBe(
    "≥100% local delivery from Wind",
  );
});

it("rounds a reading to a whole percent unless that would cross the target", () => {
  const retention: CompiledRuleObjective = {
    id: "retention",
    label: "Retain the community",
    required: true,
    metric: "customerRetention",
    deadlineMonth: 11,
    minRetainedShare: 0.8,
  };
  expect(objectiveValueText(retention, 1.01234, 0.8)).toBe("101%");
  expect(objectiveValueText(retention, 0.79996, 0.8)).toBe("80% (below goal)");
  expect(
    objectiveObservedText(
      result({
        objective: retention,
        id: "retention",
        metric: "customerRetention",
        target: 0.8,
        observed: 1.01234,
        observedMonths: 0,
        requiredMonths: 1,
      }),
    ),
  ).toBe("101% now");
});

it("names a goal that never closed as not reached once the run is over", () => {
  expect(finishedObjectiveStatusText.inProgress).toBe("Not reached");
  expect(finishedObjectiveStatusText.pending).toBe("Not reached");
});

it("formats calendar windows from the canonical zero-based inclusive months", () => {
  expect(objectiveWindowText(localShare, 2020, 60)).toBe("2021");
  expect(
    objectiveWindowText(
      { ...localShare, fromMonth: 17, throughMonth: 19 },
      2020,
      60,
    ),
  ).toBe("Jun–Aug 2021");
  expect(
    objectiveWindowText(
      { ...localShare, fromMonth: 17, throughMonth: 30 },
      2020,
      60,
    ),
  ).toBe("Jun 2021–Jul 2022");
});

it("shows missing evidence as unavailable without inventing a measured zero", () => {
  expect(
    objectiveObservedText(
      result({ status: "unverifiable", observedMonths: 0 }),
    ),
  ).toBe("0/12 months completed · history incomplete, not verifiable");
  expect(
    objectiveObservedText(result({ observed: 0.9949999, status: "failed" })),
  ).toContain("99.5% (below goal)");
});

it.each<[CompiledRuleObjective, number, string]>([
  [
    {
      id: "budget",
      label: "Budget",
      required: true,
      metric: "emissionsBudget",
      fromMonth: 0,
      throughMonth: 11,
      budgetKgCO2e: 123456789,
    },
    123456789,
    "123k tonnes CO₂e",
  ],
  [
    {
      id: "intensity",
      label: "Footprint",
      required: true,
      metric: "emissionsPerDeliveredMWh",
      fromMonth: 0,
      throughMonth: 11,
      maxKgCO2ePerMWh: 500,
    },
    500,
    "500 kg CO₂e/MWh",
  ],
  [
    {
      id: "local",
      label: "Local fuel",
      required: true,
      metric: "localFuelShare",
      fromMonth: 0,
      throughMonth: 11,
      minShare: 0.5,
      fuels: ["Wind"],
    },
    0.5,
    "50%",
  ],
  [
    {
      id: "retention",
      label: "Customers",
      required: true,
      metric: "customerRetention",
      deadlineMonth: 11,
      minRetainedShare: 0.9,
    },
    0.9,
    "90%",
  ],
  [
    {
      id: "retire",
      label: "Retire coal",
      required: true,
      metric: "fuelRetirement",
      deadlineMonth: 11,
      fuel: "Coal",
    },
    1,
    "1 owned Coal asset",
  ],
  [
    {
      id: "rate",
      label: "Bills",
      required: false,
      metric: "monthlyBilledRate",
      fromMonth: 0,
      throughMonth: 11,
      maxDollarsPerKWh: 0.123456789,
    },
    0.123456789,
    "12.3¢/kWh",
  ],
  [
    {
      id: "debt",
      label: "Debt",
      required: true,
      metric: "monthEndDebt",
      fromMonth: 0,
      throughMonth: 11,
      maxDebt: 123456789,
    },
    123456789,
    "$123M",
  ],
])(
  "prints compact units with at most three significant digits for a %s target",
  (objective, value, expected) => {
    expect(objectiveValueText(objective, value)).toBe(expected);
    expect(objectiveValueText(objective, value, value)).toBe(expected);
  },
);

it("clears zero signs without hiding a genuinely negative objective measurement", () => {
  expect(objectiveValueText(localShare, -0)).toBe("0%");
  expect(objectiveValueText(localShare, -0.00001)).not.toBe("0%");
});

it("keeps lone retirement goals and optional obligations distinct", () => {
  const retirements = UTILITY_EXPANSION_OBJECTIVES.filter(
    (objective) => objective.metric === "assetRetirement",
  );
  const lone = objectiveGoalGroups(retirements.slice(0, 1), 2005, 240);
  expect(lone).toHaveLength(1);
  expect(lone[0].goals[0]).toContain(retirements[0].label);
  const mixed = objectiveGoalGroups(
    [retirements[0], { ...retirements[1], required: false }],
    2005,
    240,
  );
  expect(mixed).toHaveLength(2);
  expect(mixed.map((goal) => goal.required)).toEqual([true, false]);
});
