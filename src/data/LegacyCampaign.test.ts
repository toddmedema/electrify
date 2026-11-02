import {
  LEGACY_CAMPAIGN_ID,
  LEGACY_GENERATIONS,
  LEGACY_GENERATION_MONTHS,
  LEGACY_SCENARIOS,
  legacyRuleDefinitions,
  legacyPolicyAllowed,
} from "./LegacyCampaign";
import { SCENARIOS, getScenario } from "./Scenarios";
import { scenarioRules, compileScenarioRules } from "../helpers/ScenarioRules";
import { getCostTableDeflator } from "./Economy";
import { LOCATIONS } from "../Constants";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../helpers/DateTime";
import { resolveStoryAtDate } from "./WorldEvents";

test("the final CEO inherits the same aging oil cohort without derating its replacements", () => {
  const outputAt = (index: number, year: number) => {
    const scenario = LEGACY_SCENARIOS[index];
    return resolveStoryAtDate({
      rules: scenarioRules(scenario, { difficulty: "Manager", seed: 611 }),
      seed: 611,
      scenarioId: scenario.id,
      difficulty: "Manager",
      date: getDateFromMinute(
        (year - scenario.startingYear!) * 12 * MINUTES_PER_MONTH,
        scenario.startingYear!,
      ),
      location: LOCATIONS.SF,
      snapshot: {
        facilities: [2000, 2001].map((commissionedYear, index) => ({
          id: index + 1,
          name: `Oil ${commissionedYear}`,
          fuel: "Oil" as const,
          ageYears: year - commissionedYear,
          peakW: 1000000,
          operational: true,
          minuteCreated: (commissionedYear - 1882) * 12 * MINUTES_PER_MONTH,
        })),
        demandWh12m: 1000,
        unservedWh12m: 0,
        deliveredWhByFuel12m: {},
        netIncome12m: 1,
        peakDemandW12m: 2000000,
        firmPeakW: 2000000,
        storagePeakW: 0,
        storagePeakWh: 0,
      },
    }).effects.facilityOutputMultipliersById;
  };
  expect(outputAt(7, 2030)).toEqual({ "1": 0.6 });
  expect(outputAt(8, 2042)).toEqual({ "1": 0.6 });
});

test("authored debt allowances scale opening demand and never borrow a fixture cash balance", () => {
  expect(
    LEGACY_GENERATIONS.map(({ debtDollars2023PerMW }) => debtDollars2023PerMW),
  ).toEqual([
    20000000, 20000000, 20000000, 30000000, 30000000, 20000000, 15000000,
    15000000, 15000000,
  ]);
  const allowance = () => {
    const objective = legacyRuleDefinitions(2, { peakMW: 0.5 }).objectives.find(
      (goal) => goal.metric === "monthEndDebt",
    );
    if (!objective || objective.metric !== "monthEndDebt")
      throw new Error("Missing debt allowance");
    return objective.maxDebtDollars;
  };
  const before = allowance();
  expect(before).toBeCloseTo(0.5 * 20000000 * getCostTableDeflator(1882), 10);
  const cash = LEGACY_SCENARIOS[2].cash;
  try {
    LEGACY_SCENARIOS[2].cash = cash * 100;
    expect(allowance()).toBe(before);
  } finally {
    LEGACY_SCENARIOS[2].cash = cash;
  }
});

test("the campaign resolves nine consecutive CEO terms without entering the challenge catalog", () => {
  LEGACY_GENERATIONS.forEach((generation, index) => {
    expect(generation.startYear).toBe(1882 + index * 20);
    expect(generation.scenarioId).toBe(LEGACY_CAMPAIGN_ID + index);
    expect(getScenario(generation.scenarioId)).toBe(LEGACY_SCENARIOS[index]);
    expect(LEGACY_SCENARIOS[index].durationMonths).toBe(
      LEGACY_GENERATION_MONTHS,
    );
    expect(SCENARIOS.some(({ id }) => id === generation.scenarioId)).toBe(
      false,
    );
  });
});

test.each(LEGACY_SCENARIOS)(
  "$name uses only bounded existing effects and objective contracts",
  (scenario) => {
    const compiled = scenarioRules(scenario, {
      difficulty: "Manager",
      seed: 611,
    });
    expect(compiled).toBeDefined();
    expect(compiled!.objectives.length).toBeLessThanOrEqual(16);
    expect(
      compiled!.objectives.find(({ id }) => id === "retain-customers"),
    ).toMatchObject({
      metric: "customerRetention",
      deadlineMonth: 239,
      minRetainedShare: 0.9,
    });
    expect(
      compiled!.objectives.every(
        (objective) =>
          !("throughMonth" in objective) || objective.throughMonth < 240,
      ),
    ).toBe(true);
  },
);

test("a historical event moved beyond a CEO term is rejected by the owning compiler", () => {
  const definition = legacyRuleDefinitions(6);
  definition.events = definition.events!.map((event) =>
    event.id === "bootleg-fire" ? { ...event, startMonth: 241 } : event,
  );
  expect(() =>
    compileScenarioRules(definition, {
      namespace: {
        kind: "official",
        scenarioId: 123,
        arcId: "invalid-campaign-test",
      },
      difficulty: "Manager",
      seed: 611,
      startingYear: 2002,
      durationMonths: 240,
      startingPeakW: 100000000,
      startingAssetIds: [],
    }),
  ).toThrow(/after this run ends|outside|month/i);
});

test("future customer programs cannot leak into early generations", () => {
  expect(legacyPolicyAllowed(117, "efficiency", 1882)).toBe(false);
  expect(legacyPolicyAllowed(121, "efficiency", 1972)).toBe(false);
  expect(legacyPolicyAllowed(121, "efficiency", 1973)).toBe(true);
  expect(legacyPolicyAllowed(121, "battery", 1979)).toBe(false);
  expect(legacyPolicyAllowed(123, "evCharging", 2009)).toBe(false);
  expect(legacyPolicyAllowed(123, "evCharging", 2010)).toBe(true);
  expect(legacyPolicyAllowed(100, "efficiency", 1882)).toBe(true);
});

test("recorded fuel crises are not multiplied a second time by campaign events", () => {
  for (const index of [4, 5]) {
    const events = legacyRuleDefinitions(index).events!;
    expect(events.some((event) => event.effects?.fuelPriceMultipliers)).toBe(
      false,
    );
  }
});
