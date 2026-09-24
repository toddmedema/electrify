import {
  ActiveWorldEventType,
  FacilityOperatingType,
  GameType,
  GeneratorShoppingType,
  LocationType,
} from "../Types";
import { LOCATIONS } from "../Constants";
import {
  getWeatherHazardProfile,
  HAIL_DEDUCTIBLE_SHARE,
  HAIL_MAX_DAMAGED_FRACTION,
  HAIL_RESISTANT_DAMAGE_FACTOR,
} from "../data/Hazards";
import { getDateFromMinute, MINUTES_PER_MONTH } from "./DateTime";
import { randomAt, RANDOM_STREAM } from "./Math";
import { storyHash } from "../data/WorldEvents";
import {
  annualInsuranceCost,
  applyDefaultResilience,
  COLD_DEFINITION_ID,
  facilityHazardStatus,
  facilityResilienceSummary,
  HAIL_DEFINITION_ID,
  hailMonthlyProbability,
  hazardDraw,
  hazardEventKey,
  hazardInsuranceComparison,
  isWeatherHazardEligible,
  oneTimeWorldEventCost,
  refreshInsurancePremiums,
  replacementValue,
  representativeMinTempC,
  resilienceBuildOption,
  resolveColdImpact,
  retrofitCost,
  retrofittedResilience,
  sampleHailImpacts,
  summarizeWeatherHazardImpact,
  withResilienceOption,
  realDaysToGameMinutes,
} from "./Hazards";

const DENVER: LocationType = {
  id: "Denver",
  name: "Denver, CO",
  lat: 39.74,
  long: -104.99,
};
const DALLAS: LocationType = {
  id: "Dallas",
  name: "Dallas, TX",
  lat: 32.78,
  long: -96.8,
};
const REYKJAVIK: LocationType = {
  id: "Reykjavik",
  name: "Reykjavik",
  lat: 64.15,
  long: -21.94,
};
const CORDOBA: LocationType = {
  id: "Cordoba",
  name: "Cordoba",
  lat: -31.42,
  long: -64.18,
};

function facility(
  id: number,
  fuel: string | undefined,
  overrides: Partial<FacilityOperatingType> = {},
): FacilityOperatingType {
  return {
    id,
    name: `${fuel ?? "Storage"} ${id}`,
    fuel,
    buildCost: 100_000_000,
    peakW: 100_000_000,
    yearsToBuildLeft: 0,
    minuteCreated: 0,
    paused: false,
    ...overrides,
  } as unknown as FacilityOperatingType;
}

function gameAt(
  location: LocationType,
  facilities: FacilityOperatingType[] = [],
  overrides: Partial<GameType> = {},
): GameType {
  return {
    seed: 101,
    scenarioId: 100,
    location,
    startingYear: 2020,
    date: getDateFromMinute(0, 2020),
    facilities,
    worldEvents: { active: [], occurrences: [], checkedKeys: [] },
    ...overrides,
  } as unknown as GameType;
}

function quote(fuel: string, buildCost = 50_000_000): GeneratorShoppingType {
  return { name: fuel, fuel, buildCost } as unknown as GeneratorShoppingType;
}

/** The first storm key, for a fleet, whose sampled hits include every listed facility. */
function keyHitting(game: GameType, ids: number[]): string {
  for (let month = 0; month < 500; month++) {
    const key = hazardEventKey("HAIL", game.location.id, month);
    const hit = sampleHailImpacts({ game, key }).map((i) => i.facilityId);
    if (ids.every((id) => hit.includes(id))) {
      return key;
    }
  }
  throw new Error("No storm hit the requested facilities");
}

describe("weather hazard draws", () => {
  it("formats stable event keys", () => {
    expect(hazardEventKey("HAIL", "Denver", 37)).toBe("hail:Denver:37");
    expect(hazardEventKey("EXTREME_COLD", "PIT", 2)).toBe("cold:PIT:2");
  });

  it("draws addressed values on a dedicated stream", () => {
    const a = hazardDraw(101, "hail:Denver:3", "occurrence");
    expect(a).toBe(hazardDraw(101, "hail:Denver:3", "occurrence"));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
    expect(a).not.toBe(hazardDraw(101, "hail:Denver:3", "intensity"));
    expect(a).not.toBe(hazardDraw(202, "hail:Denver:3", "occurrence"));
    expect(RANDOM_STREAM.weatherHazards).not.toBe(
      RANDOM_STREAM.wildfireHazards,
    );
    expect(a).not.toBe(
      randomAt(
        101,
        RANDOM_STREAM.wildfireHazards,
        storyHash("hail:Denver:3|occurrence"),
      ),
    );
    expect(new Set(Object.values(RANDOM_STREAM)).size).toBe(
      Object.values(RANDOM_STREAM).length,
    );
  });
});

describe("isWeatherHazardEligible", () => {
  it("runs in scored and custom games", () => {
    expect(isWeatherHazardEligible(gameAt(DENVER), "HAIL")).toBe(true);
    expect(
      isWeatherHazardEligible(
        gameAt(DENVER, [], { scenarioId: 999 }),
        "EXTREME_COLD",
      ),
    ).toBe(true);
  });

  it("skips tutorials, harness baselines, and authored freezes for cold", () => {
    [0, 1, 2, 3, 4, 5, 112].forEach((scenarioId) => {
      expect(
        isWeatherHazardEligible(gameAt(DENVER, [], { scenarioId }), "HAIL"),
      ).toBe(false);
    });
    expect(
      isWeatherHazardEligible(
        gameAt(DENVER, [], { weatherHazardsDisabled: true }),
        "HAIL",
      ),
    ).toBe(false);
    expect(
      isWeatherHazardEligible(
        gameAt(DENVER, [], { storyEffectsDisabled: true }),
        "HAIL",
      ),
    ).toBe(false);
    [103, 107].forEach((scenarioId) => {
      const game = gameAt(DENVER, [], { scenarioId });
      expect(isWeatherHazardEligible(game, "HAIL")).toBe(true);
      expect(isWeatherHazardEligible(game, "EXTREME_COLD")).toBe(false);
    });
  });
});

describe("hailMonthlyProbability", () => {
  const denver = getWeatherHazardProfile(DENVER);

  it("follows the northern convective season", () => {
    expect(hailMonthlyProbability(denver, DENVER, 0)).toBe(0);
    expect(hailMonthlyProbability(denver, DENVER, 5)).toBeCloseTo(
      1 - Math.exp(-0.08 * 0.25),
      12,
    );
  });

  it("shifts the season six months in the southern hemisphere", () => {
    const cordoba = getWeatherHazardProfile(CORDOBA);
    expect(hailMonthlyProbability(cordoba, CORDOBA, 11)).toBeCloseTo(
      hailMonthlyProbability(cordoba, DENVER, 5),
      12,
    );
    expect(hailMonthlyProbability(cordoba, CORDOBA, 6)).toBe(0);
  });

  it("spreads tropical risk evenly and keeps the annual rate", () => {
    const tropical = { ...DENVER, lat: 10 };
    const months = Array.from({ length: 12 }, (_, m) =>
      hailMonthlyProbability(denver, tropical, m),
    );
    expect(new Set(months).size).toBe(1);
    const lambda = Array.from(
      { length: 12 },
      (_, m) => -Math.log(1 - hailMonthlyProbability(denver, DENVER, m)),
    ).reduce((a, b) => a + b, 0);
    expect(lambda).toBeCloseTo(0.08, 9);
  });
});

describe("representativeMinTempC", () => {
  it("adds the story temperature offset to the day's coldest hour", () => {
    const date = getDateFromMinute(0, 2020);
    const base = representativeMinTempC(date, 1);
    expect(representativeMinTempC(date, 1, -6)).toBeCloseTo(base - 6, 9);
  });
});

describe("sampleHailImpacts", () => {
  const fleet = () => [
    facility(3, "Sun"),
    facility(1, "Sun"),
    facility(2, "Sun", { yearsToBuildLeft: 1 }),
    facility(4, "Natural Gas"),
    facility(5, "Sun", { paused: true }),
  ];

  it("damages operational solar only, sorted and bounded", () => {
    const game = gameAt(DENVER, fleet());
    const key = keyHitting(game, [1, 3]);
    const impacts = sampleHailImpacts({ game, key });
    const ids = impacts.map((i) => i.facilityId);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(ids).not.toContain(2);
    expect(ids).not.toContain(4);
    impacts.forEach((impact) => {
      expect(impact.damagedFraction).toBeGreaterThan(0);
      expect(impact.damagedFraction).toBeLessThanOrEqual(
        HAIL_MAX_DAMAGED_FRACTION,
      );
      expect(Number.isInteger(impact.repairDays)).toBe(true);
      expect(impact.repairDays).toBeGreaterThanOrEqual(4);
      expect(impact.repairMinutes).toBe(
        realDaysToGameMinutes(impact.repairDays),
      );
      expect(impact.repairCost).toBeCloseTo(impact.damagedFraction * 1e8, 3);
      expect(impact.deductible).toBeLessThanOrEqual(impact.repairCost);
      expect(impact.deductible).toBeLessThanOrEqual(
        HAIL_DEDUCTIBLE_SHARE * 1e8,
      );
    });
  });

  it("is independent of fleet order", () => {
    const game = gameAt(DENVER, fleet());
    const key = keyHitting(game, [1, 3]);
    const reversed = gameAt(DENVER, fleet().reverse());
    expect(sampleHailImpacts({ game: reversed, key })).toEqual(
      sampleHailImpacts({ game, key }),
    );
  });

  it("breaks less of a hail-resistant array from the same storm", () => {
    const standard = gameAt(DENVER, [facility(1, "Sun")]);
    const key = keyHitting(standard, [1]);
    const resistant = gameAt(DENVER, [
      facility(1, "Sun", { resilience: { hailResistant: true } }),
    ]);
    const [a] = sampleHailImpacts({ game: standard, key });
    const [b] = sampleHailImpacts({ game: resistant, key });
    expect(b.hailResistant).toBe(true);
    expect(b.damagedFraction).toBeCloseTo(
      a.damagedFraction * HAIL_RESISTANT_DAMAGE_FACTOR,
      12,
    );
    expect(b.repairDays).toBeLessThanOrEqual(a.repairDays);
  });
});

describe("resolveColdImpact", () => {
  const key = hazardEventKey("EXTREME_COLD", "Dallas", 1);

  it("does nothing on an ordinary winter day", () => {
    const game = gameAt(DALLAS, [facility(1, "Natural Gas")]);
    expect(resolveColdImpact({ game, key, minTempC: -5 })).toBeUndefined();
  });

  it("trips a mild-climate plant without a regional gas shock", () => {
    const game = gameAt(DALLAS, [facility(1, "Natural Gas")]);
    const impact = resolveColdImpact({ game, key, minTempC: -10 })!;
    expect(impact.regional).toBe(false);
    expect(impact.gasPriceMultiplier).toBe(1);
    expect(impact.derates).toHaveLength(1);
  });

  it("derates standard plants and spikes gas below the regional threshold", () => {
    const game = gameAt(DALLAS, [
      facility(2, "Natural Gas", {
        resilience: { coldWeatherPackage: true, designMinTempC: -25 },
      }),
      facility(1, "Natural Gas", { resilience: { designMinTempC: -8 } }),
      facility(3, "Sun"),
      facility(4, "Natural Gas", { yearsToBuildLeft: 2 }),
    ]);
    // Dallas strains regionally below -15 °C, well under a standard plant's -8 °C rating.
    const impact = resolveColdImpact({ game, key, minTempC: -20 })!;
    expect(impact.regional).toBe(true);
    expect(impact.gasPriceMultiplier).toBeCloseTo(1.5 + 0.1 * 5, 12);
    expect(impact.derates.map((d) => d.facilityId)).toEqual([1]);
    const derate = 1 - impact.derates[0].availableFraction;
    expect(derate).toBeGreaterThanOrEqual((0.2 + 0.04 * 12) * 0.85 - 1e-12);
    expect(derate).toBeLessThanOrEqual((0.2 + 0.04 * 12) * 1.15 + 1e-12);
    expect(impact.protectedFacilityIds).toEqual([2]);
  });

  it("halves the derate for a packaged plant pushed past its rating", () => {
    const standard = gameAt(REYKJAVIK, [
      facility(1, "Natural Gas", { resilience: { designMinTempC: -30 } }),
    ]);
    const packaged = gameAt(REYKJAVIK, [
      facility(1, "Natural Gas", {
        resilience: { coldWeatherPackage: true, designMinTempC: -30 },
      }),
    ]);
    const a = resolveColdImpact({ game: standard, key, minTempC: -36 })!;
    const b = resolveColdImpact({ game: packaged, key, minTempC: -36 })!;
    expect(1 - b.derates[0].availableFraction).toBeCloseTo(
      (1 - a.derates[0].availableFraction) * 0.5,
      12,
    );
  });

  it("caps derates and gas prices in extreme cold", () => {
    const game = gameAt(DALLAS, [facility(1, "Natural Gas")]);
    const impact = resolveColdImpact({ game, key, minTempC: -59 })!;
    expect(impact.gasPriceMultiplier).toBe(3);
    expect(impact.derates[0].availableFraction).toBeGreaterThanOrEqual(0.25);
  });
});

describe("replacement value and insurance", () => {
  it("prices solar weather insurance from local hail exposure", () => {
    const sun = facility(1, "Sun");
    const denver = gameAt(DENVER, [sun]);
    expect(replacementValue(sun, denver)).toBe(1e8);
    expect(annualInsuranceCost(sun, denver)).toBeCloseTo(
      1e8 * 0.002 * (0.08 / 0.05),
      6,
    );
    const resistant = facility(2, "Sun", {
      resilience: { hailResistant: true },
    });
    expect(annualInsuranceCost(resistant, denver)).toBeCloseTo(
      annualInsuranceCost(sun, denver) * 0.4,
      6,
    );
    expect(annualInsuranceCost(facility(3, "Natural Gas"), denver)).toBe(0);
    expect(
      annualInsuranceCost(sun, gameAt(DENVER, [], { scenarioId: 0 })),
    ).toBe(0);
  });

  it("refreshes premiums in place and clears ones that no longer apply", () => {
    const gas = facility(2, "Natural Gas", { annualInsuranceCost: 50 });
    const game = gameAt(DENVER, [
      facility(1, "Sun"),
      gas,
      facility(3, undefined),
    ]);
    refreshInsurancePremiums(game);
    expect(game.facilities[0].annualInsuranceCost).toBeGreaterThan(0);
    expect("annualInsuranceCost" in game.facilities[1]).toBe(false);
    expect("annualInsuranceCost" in game.facilities[2]).toBe(false);
  });
});

describe("retrofitCost", () => {
  it("prices retrofits from replacement value", () => {
    const game = gameAt(DENVER);
    expect(retrofitCost(facility(1, "Sun"), game, "hailResistant")).toBe(8e6);
    expect(
      retrofitCost(facility(1, "Natural Gas"), game, "coldWeatherPackage"),
    ).toBe(4e6);
  });

  it("is not offered for the wrong technology, twice, or without the hazard", () => {
    const game = gameAt(DENVER);
    expect(
      retrofitCost(facility(1, "Natural Gas"), game, "hailResistant"),
    ).toBeUndefined();
    expect(
      retrofitCost(
        facility(1, "Sun", { resilience: { hailResistant: true } }),
        game,
        "hailResistant",
      ),
    ).toBeUndefined();
    expect(
      retrofitCost(
        facility(1, "Natural Gas"),
        gameAt(DENVER, [], { scenarioId: 107 }),
        "coldWeatherPackage",
      ),
    ).toBeUndefined();
  });
});

describe("retrofitCost under construction", () => {
  it("is not offered until the facility is operating", () => {
    const game = gameAt(DENVER);
    const building = facility(1, "Sun", { yearsToBuildLeft: 0.5 });
    expect(retrofitCost(building, game, "hailResistant")).toBeUndefined();
    expect(
      facilityResilienceSummary(game, building)!.retrofitCost,
    ).toBeUndefined();
  });
});

describe("hazardInsuranceComparison", () => {
  it("prices a solar quote's insurance with and without hail protection", () => {
    const game = gameAt(DENVER);
    const comparison = hazardInsuranceComparison(quote("Sun"), game)!;
    expect(comparison.standard).toBeCloseTo(5e7 * 0.002 * (0.08 / 0.05), 6);
    expect(comparison.hardened).toBeCloseTo(
      5e7 * 1.03 * 0.002 * (0.08 / 0.05) * 0.4,
      6,
    );
    // The same answer whichever way the quote's option is currently set.
    expect(
      hazardInsuranceComparison(
        withResilienceOption(quote("Sun"), game, true),
        game,
      ),
    ).toEqual(comparison);
  });

  it("is undefined without a hail option", () => {
    expect(
      hazardInsuranceComparison(quote("Natural Gas"), gameAt(DENVER)),
    ).toBeUndefined();
    expect(
      hazardInsuranceComparison(
        quote("Sun"),
        gameAt(DENVER, [], { scenarioId: 1 }),
      ),
    ).toBeUndefined();
  });
});

describe("retrofittedResilience", () => {
  it("installs the upgrade and re-rates a gas plant for its location", () => {
    expect(
      retrofittedResilience(
        facility(1, "Sun"),
        gameAt(DENVER),
        "hailResistant",
      ),
    ).toEqual({ hailResistant: true });
    expect(
      retrofittedResilience(
        facility(1, "Natural Gas", {
          resilience: { coldWeatherPackage: false, designMinTempC: -8 },
        }),
        gameAt(REYKJAVIK),
        "coldWeatherPackage",
      ),
    ).toEqual({ coldWeatherPackage: true, designMinTempC: -30 });
  });
});

describe("resilience build options", () => {
  it("offers hail-resistant solar, off by default", () => {
    const game = gameAt(DENVER);
    const option = resilienceBuildOption(quote("Sun"), game)!;
    expect(option).toMatchObject({
      upgrade: "hailResistant",
      defaultSelected: false,
      selected: false,
    });
    expect(option.extraBuildCost).toBe(1.5e6);
    expect(applyDefaultResilience(quote("Sun"), game)).toMatchObject({
      buildCost: 50_000_000,
      resilience: { hailResistant: false },
    });
  });

  it("winterizes gas by default only in cold climates", () => {
    const cold = applyDefaultResilience(
      quote("Natural Gas"),
      gameAt(REYKJAVIK),
    );
    expect(cold.resilience).toEqual({
      coldWeatherPackage: true,
      designMinTempC: -30,
    });
    expect(cold.buildCost).toBeCloseTo(51_000_000, 6);
    expect(cold.resilienceExtraBuildCost).toBeCloseTo(1_000_000, 6);
    const mild = applyDefaultResilience(quote("Natural Gas"), gameAt(DALLAS));
    expect(mild.resilience).toEqual({
      coldWeatherPackage: false,
      designMinTempC: -8,
    });
    expect(mild.buildCost).toBe(50_000_000);
    expect(mild.resilienceExtraBuildCost).toBeUndefined();
  });

  it("toggles the option exactly and idempotently", () => {
    const game = gameAt(DALLAS);
    const base = quote("Natural Gas", 123_456_789.123);
    const on = withResilienceOption(base, game, true);
    expect(withResilienceOption(on, game, true)).toEqual(on);
    const off = withResilienceOption(on, game, false);
    expect(off.buildCost).toBe(123_456_789.123);
    expect(Number.isInteger(on.resilienceExtraBuildCost)).toBe(true);
    expect(withResilienceOption(off, game, false)).toEqual(off);
    expect(resilienceBuildOption(on, game)!.selected).toBe(true);
    expect(resilienceBuildOption(on, game)!.extraBuildCost).toBeCloseTo(
      on.resilienceExtraBuildCost!,
      6,
    );
  });

  it("offers nothing for other technologies or where the hazard is off", () => {
    expect(
      resilienceBuildOption(quote("Wind"), gameAt(DENVER)),
    ).toBeUndefined();
    const tutorial = gameAt(DENVER, [], { scenarioId: 1 });
    expect(resilienceBuildOption(quote("Sun"), tutorial)).toBeUndefined();
    expect(applyDefaultResilience(quote("Sun"), tutorial).resilience).toBe(
      undefined,
    );
    // Gas still records its standard rating so a later retrofit has a baseline.
    const texas = gameAt(DALLAS, [], { scenarioId: 107 });
    expect(resilienceBuildOption(quote("Natural Gas"), texas)).toBeUndefined();
    expect(
      withResilienceOption(quote("Natural Gas"), texas, true),
    ).toMatchObject({
      buildCost: 50_000_000,
      resilience: { coldWeatherPackage: false, designMinTempC: -8 },
    });
  });
});

function hailOccurrence(
  id: number,
  startsMinute: number,
  endsMinute: number,
  multiplier: number,
  deductible = 0,
): ActiveWorldEventType {
  return {
    key: `hail:Denver:0:f${id}`,
    definitionId: HAIL_DEFINITION_ID,
    startsMinute,
    endsMinute,
    attributes: {
      hazard: "HAIL",
      eventKey: "hail:Denver:0",
      facilityId: id,
      oneTimeCost: deductible,
      oneTimeCostMinute: startsMinute + 15,
    },
    effects: { facilityOutputMultipliersById: { [id]: multiplier } },
  };
}

// Just under a whole number of real days in game minutes, so rounding up reports exactly `days`.
function realDays(days: number): number {
  return Math.floor((days * MINUTES_PER_MONTH) / (365 / 12));
}

describe("facilityHazardStatus", () => {
  it("combines overlapping outages and runs to the last repair", () => {
    const sun = facility(1, "Sun");
    const game = gameAt(DENVER, [sun]);
    game.date = getDateFromMinute(1440, 2020);
    game.worldEvents.active.push(
      hailOccurrence(1, 0, 1440 + realDays(10), 0.8),
      hailOccurrence(1, 0, 1440 + realDays(4), 0.7),
      {
        ...hailOccurrence(1, 0, MINUTES_PER_MONTH, 0.9),
        definitionId: COLD_DEFINITION_ID,
      },
    );
    const status = facilityHazardStatus(game, sun)!;
    expect(status).toMatchObject({
      hazard: "HAIL",
      label: "Hail damage",
      daysLeft: 10,
      endsMinute: 1440 + realDays(10),
    });
    expect(status.availableFraction).toBeCloseTo(0.8 * 0.7, 12);
    expect(facilityHazardStatus(game, facility(2, "Sun"))).toBeUndefined();
  });

  it("labels a cold-only outage as extreme cold", () => {
    const gas = facility(1, "Natural Gas");
    const game = gameAt(DALLAS, [gas]);
    game.worldEvents.active.push({
      ...hailOccurrence(1, 0, MINUTES_PER_MONTH, 0.6),
      definitionId: COLD_DEFINITION_ID,
    });
    expect(facilityHazardStatus(game, gas)).toEqual({
      hazard: "EXTREME_COLD",
      label: "Extreme cold",
      availableFraction: 0.6,
      endsMinute: MINUTES_PER_MONTH,
    });
  });

  it("ignores an outage that began before the facility was bought", () => {
    const game = gameAt(DENVER);
    game.date = getDateFromMinute(1440, 2020);
    game.worldEvents.active.push(hailOccurrence(1, 0, 1440 * 10, 0.8));
    const reused = facility(1, "Sun", { minuteCreated: 1000 });
    expect(facilityHazardStatus(game, reused)).toBeUndefined();
  });

  it("ignores outages outside their window", () => {
    const sun = facility(1, "Sun");
    const game = gameAt(DENVER, [sun]);
    game.date = getDateFromMinute(1440 * 20, 2020);
    game.worldEvents.active.push(hailOccurrence(1, 0, 1440 * 10, 0.8));
    expect(facilityHazardStatus(game, sun)).toBeUndefined();
  });
});

describe("facilityResilienceSummary", () => {
  it("summarizes solar hardening, retrofit and insurance", () => {
    const sun = facility(1, "Sun");
    const summary = facilityResilienceSummary(gameAt(DENVER), sun)!;
    expect(summary).toMatchObject({
      upgrade: "hailResistant",
      label: "Standard panels",
      installed: false,
      retrofitCost: 8e6,
      replacementValue: 1e8,
    });
    expect(summary.annualInsuranceCost).toBeGreaterThan(0);
  });

  it("reports a gas plant's rating and hides where cold is authored", () => {
    const gas = facility(1, "Natural Gas", {
      resilience: { coldWeatherPackage: true, designMinTempC: -30 },
    });
    expect(facilityResilienceSummary(gameAt(REYKJAVIK), gas)).toMatchObject({
      label: "Cold-weather package",
      installed: true,
      detail: "Keeps running through deeper cold.",
      retrofitCost: undefined,
      annualInsuranceCost: undefined,
    });
    expect(
      facilityResilienceSummary(gameAt(DALLAS, [], { scenarioId: 103 }), gas),
    ).toBeUndefined();
    expect(
      facilityResilienceSummary(gameAt(DENVER), facility(2, "Wind")),
    ).toBeUndefined();
  });
});

describe("oneTimeWorldEventCost", () => {
  const occurrences = [hailOccurrence(1, 0, 10_000, 0.8, 250)];
  const tick = (minute: number) => ({ minute });

  it("charges once, in the tick after onset", () => {
    expect(oneTimeWorldEventCost(occurrences, tick(0), tick(15))).toBe(250);
    expect(oneTimeWorldEventCost(occurrences, tick(15), tick(30))).toBe(0);
    expect(oneTimeWorldEventCost(occurrences, tick(-15), tick(0))).toBe(0);
  });

  it("never charges on a pre-roll frame or without a previous tick", () => {
    const frame = tick(15);
    expect(oneTimeWorldEventCost(occurrences, frame, frame)).toBe(0);
    expect(oneTimeWorldEventCost(occurrences, undefined, tick(15))).toBe(0);
  });
});

describe("summarizeWeatherHazardImpact", () => {
  it("counts storms, hits, deductibles and cold months", () => {
    const summary = summarizeWeatherHazardImpact([
      hailOccurrence(1, 0, 100, 0.8, 100),
      hailOccurrence(2, 0, 100, 0.8, 50),
      {
        key: "cold:Denver:1",
        definitionId: COLD_DEFINITION_ID,
        startsMinute: 0,
        endsMinute: MINUTES_PER_MONTH,
        attributes: { regional: true, affectedFacilityIds: [4, 5] },
        effects: {},
      },
      {
        key: "wildfire:LA:1",
        definitionId: "recurring-wildfire",
        startsMinute: 0,
        endsMinute: 1,
        attributes: {},
        effects: {},
      },
    ]);
    expect(summary).toEqual({
      hailEvents: 1,
      hailFacilityHits: 2,
      hailDeductibles: 150,
      coldEvents: 1,
      coldRegionalEvents: 1,
      coldDerates: 2,
    });
  });
});

// Shared constants must keep their locations resolvable by the profile lookup.
it("profiles every authored location", () => {
  Object.values(LOCATIONS).forEach((location) => {
    expect(
      getWeatherHazardProfile(location as LocationType).source,
    ).toBeTruthy();
  });
});
