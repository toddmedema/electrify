import type { CompiledRuleObjective } from "../data/ScenarioRules";
import type { ObjectiveResult } from "../data/ScenarioObjectives";
import { objectiveDefinition } from "./ScenarioObjectives";
import {
  finishedObjectiveStatusText,
  objectiveObservedText,
  objectiveTargetText,
  objectiveValueText,
  objectiveWindowText,
} from "./ObjectivePresentation";

const reliability: CompiledRuleObjective = {
  id: "reliability",
  label: "Keep the lights on",
  required: true,
  metric: "monthlyReliability",
  fromMonth: 12,
  throughMonth: 23,
  minDemandServedShare: 0.995,
};
const result = (changes: Partial<ObjectiveResult> = {}): ObjectiveResult => ({
  objective: reliability,
  id: reliability.id,
  metric: reliability.metric,
  label: reliability.label,
  required: true,
  definition: objectiveDefinition(reliability.metric),
  status: "inProgress",
  target: 0.995,
  observedMonths: 1,
  requiredMonths: 12,
  ...changes,
});

it("retains the actual side of an arbitrarily close share target", () => {
  expect(objectiveValueText(reliability, 0.99999999999999, 1)).not.toBe("100%");
  expect(objectiveValueText(reliability, 0.99500000000001, 0.995)).not.toBe(
    "99.5%",
  );
  expect(objectiveValueText(reliability, 0.995)).toBe("99.5%");
  expect(
    objectiveTargetText({ ...reliability, minDemandServedShare: 0.9999999 }),
  ).toBe("≥99.99999% of demand monthly");
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
  expect(objectiveValueText(retention, 0.79996, 0.8)).toContain("79.99");
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
  expect(objectiveWindowText(reliability, 2020, 60)).toBe("2021");
  expect(
    objectiveWindowText(
      { ...reliability, fromMonth: 17, throughMonth: 19 },
      2020,
      60,
    ),
  ).toBe("Jun–Aug 2021");
  expect(
    objectiveWindowText(
      { ...reliability, fromMonth: 17, throughMonth: 30 },
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
  ).toContain("99.49999%");
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
    "123,456.789 tonnes CO₂e",
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
    "500 kg CO₂e / delivered MWh",
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
    "$0.123456789/kWh",
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
    "$123,456,789 principal",
  ],
])(
  "prints explicit units without approximating a %s target",
  (objective, value, expected) => {
    expect(objectiveValueText(objective, value)).toBe(expected);
    expect(objectiveValueText(objective, value, value)).toBe(expected);
  },
);

it("clears zero signs without hiding a genuinely negative objective measurement", () => {
  expect(objectiveValueText(reliability, -0)).toBe("0%");
  expect(objectiveValueText(reliability, -0.00001)).not.toBe("0%");
});
