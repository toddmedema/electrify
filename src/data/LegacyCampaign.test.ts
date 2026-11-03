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
import { roundToSignificantDigits } from "../helpers/Math";
import { objectiveTarget } from "../helpers/ScenarioObjectives";
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
  expect(before).toBe(
    roundToSignificantDigits(0.5 * 20000000 * getCostTableDeflator(1882), 3),
  );
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
    expect(LEGACY_SCENARIOS[index].name).toBe(
      `${generation.name} (${generation.startYear}–${generation.startYear + 19})`,
    );
    expect(LEGACY_SCENARIOS[index].summary).toBeUndefined();
    expect(LEGACY_SCENARIOS[index]).not.toHaveProperty("briefing");
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
      compiled!.objectives.filter(
        ({ metric }) => metric === "customerRetention",
      ),
    ).toEqual(
      scenario.id === LEGACY_SCENARIOS[1].id
        ? []
        : [
            expect.objectContaining({
              deadlineMonth: 239,
              minRetainedShare: 0.9,
            }),
          ],
    );
    expect(
      compiled!.objectives.every(
        (objective) =>
          !("throughMonth" in objective) || objective.throughMonth < 240,
      ),
    ).toBe(true);
  },
);

test("each term leads with a distinct historical task and keeps its shared safeguards", () => {
  const featured = LEGACY_SCENARIOS.map(
    (scenario) => scenarioRules(scenario)!.objectives[0],
  );
  expect(new Set(featured.map(({ id }) => id)).size).toBe(9);
  expect(featured.map(({ metric }) => metric)).toEqual([
    "financialCoverage",
    "customerCount",
    "monthlyBilledRate",
    "reserveMargin",
    "efficiencySavings",
    "financialCoverage",
    "demandServedShare",
    "fuelRetirement",
    "emissionsBudget",
  ]);
  expect(featured[0]).toMatchObject({
    basis: "revenue",
    fromMonth: 36,
    throughMonth: 47,
  });
  expect(featured[3]).toMatchObject({ fromMonth: 120, throughMonth: 131 });
  expect(featured[5]).toMatchObject({
    basis: "cash",
    fromMonth: 222,
    throughMonth: 239,
  });
  expect(featured[6]).toMatchObject({
    hours: [17, 21],
    fromMonth: 204,
    throughMonth: 239,
  });
  expect(featured[7]).toMatchObject({
    commissionedBeforeYear: 2001,
    deadlineMonth: 167,
  });
});

test("customer expansion has a frozen feasible target for the inherited territory", () => {
  const growthGoal = (openingCustomers: number, endMarketCustomers: number) =>
    legacyRuleDefinitions(1, { openingCustomers, endMarketCustomers })
      .objectives[0];
  expect(growthGoal(100, 1000)).toMatchObject({ minCustomers: 150 });
  expect(growthGoal(1000, 1400)).toMatchObject({ minCustomers: 1330 });
});

test("published campaign amounts are the exact three-significant-digit thresholds", () => {
  for (const scenario of LEGACY_SCENARIOS)
    for (const objective of scenarioRules(scenario)!.objectives) {
      const target = objectiveTarget(objective);
      expect(target).toBe(roundToSignificantDigits(target, 3));
    }
});

test.each([
  { index: 1, metrics: ["customerCount", "monthEndDebt"] },
  {
    index: 8,
    metrics: [
      "emissionsBudget",
      "customerRetention",
      "monthEndDebt",
      "monthlyBilledRate",
    ],
  },
])(
  "term $index has no redundant customer or carbon goals",
  ({ index, metrics }) => {
    expect(
      scenarioRules(LEGACY_SCENARIOS[index])!.objectives.map(
        ({ metric }) => metric,
      ),
    ).toEqual(metrics);
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
