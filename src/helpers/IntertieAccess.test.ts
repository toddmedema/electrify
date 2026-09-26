import { MAX_INTERTIE_UPGRADES } from "../Constants";
import {
  corridorById,
  intertiesEnabledForScenario,
} from "../data/AdjacentMarkets";
import {
  accessContextForGame,
  corridorsForGame,
  effectiveCorridor,
  effectiveMarket,
  SCENARIO_INTERTIE_ACCESS,
} from "../data/IntertieAccess";
import { SCENARIOS } from "../data/Scenarios";
import { MINUTES_PER_MONTH } from "./DateTime";
import { getScenarioLocation } from "./Locations";
import {
  allocateIntertieFlows,
  IntertieContext,
  IntertieOffer,
  intertieImportLimitW,
  intertieUpgradeCount,
  intertieUpgradeQuote,
  neighborImportSupplyW,
} from "./Transmission";

const mild = { temperatureC: 20, solarIrradianceWM2: 0 };
const scenario = (id: number) => SCENARIOS.find((item) => item.id === id)!;
const game = (id: number) => ({
  scenarioId: id,
  location: getScenarioLocation(scenario(id))!,
  customScenario: undefined,
  date: { year: scenario(id).startingYear },
});
const context = (id: number): IntertieContext => ({
  ...accessContextForGame(game(id)),
  seed: 12345,
  southernHemisphere: false,
  peakSharingImportLoss: 0.5,
  expectedLuck: true,
});

describe("authored utility transmission access", () => {
  it("covers every enabled scenario corridor with valid fixed allocations", () => {
    const keys = SCENARIO_INTERTIE_ACCESS.map(
      (row) => `${row.scenarioId}:${row.corridorId}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
    for (const row of SCENARIO_INTERTIE_ACCESS) {
      expect(game(row.scenarioId).location.id).toBe(row.locationId);
      expect(corridorById(row.corridorId)).toBeDefined();
      expect(row.capacityW).toBeGreaterThan(0);
      expect(row.availableSupplyW).toBeGreaterThan(0);
      expect(row.availableDemandW).toBeGreaterThan(0);
      // An authored allocation on a path that did not exist yet would be unreachable
      expect(
        corridorsForGame(game(row.scenarioId)).map(({ id }) => id),
      ).toContain(row.corridorId);
    }
    for (const authored of SCENARIOS) {
      const state = game(authored.id);
      if (!intertiesEnabledForScenario(authored, state.location)) continue;
      for (const corridor of corridorsForGame(state)) {
        expect(keys).toContain(`${authored.id}:${corridor.id}`);
      }
    }
  });

  it("quotes the player's share without modifying the regional corridor", () => {
    const access = effectiveCorridor("california-north", context(111))!;
    expect(access.capacityW).toBe(5e6);
    expect(access.buildCost).toBe(1.8e6);
    expect(access.annualOperatingCost).toBe(36000);
    expect(access.yearsToBuild).toBe(1);
    expect(corridorById(access.id)!.capacityW).toBe(500e6);
    const growingGame = { ...game(111), customers: 1e9 };
    expect(corridorsForGame(growingGame)).toEqual(corridorsForGame(game(111)));
  });

  it("does not inherit scenario access into custom games or another location", () => {
    const custom = {
      ...game(111),
      customScenario: { ...scenario(111), id: -1 },
    };
    expect(
      effectiveCorridor("california-north", accessContextForGame(custom))!
        .capacityW,
    ).toBe(500e6);
    expect(
      effectiveCorridor("california-north", {
        scenarioId: 111,
        locationId: "SF",
      })!.capacityW,
    ).toBe(500e6);
    expect(effectiveCorridor("missing", context(111))).toBeUndefined();
    expect(effectiveMarket("missing", context(111))).toBeUndefined();
    for (const id of [104, 105]) {
      expect(corridorsForGame(game(id))).toEqual([]);
      expect(intertiesEnabledForScenario(scenario(id), game(id).location)).toBe(
        false,
      );
    }
  });

  it("prices upgrades from purchased access while neighboring supply stays fixed", () => {
    const ctx = context(111);
    let line = {
      corridorId: "california-north",
      capacityW: 5e6,
      annualOperatingCost: 36000,
    };
    const supply = neighborImportSupplyW(line.corridorId, ctx, 0, mild);
    expect(supply).toBeCloseTo(3.2e6);
    const firstQuote = intertieUpgradeQuote(line, 2024, 1, 1, ctx)!;
    expect(firstQuote.targetCapacityW).toBe(7.5e6);
    expect(firstQuote.buildCost).toBe(450000);
    for (let step = 0; step < MAX_INTERTIE_UPGRADES; step++) {
      expect(intertieUpgradeCount(line, ctx)).toBe(step);
      const quote = intertieUpgradeQuote(line, 2024, 1, 1, ctx)!;
      expect(quote).toBeDefined();
      expect(intertieImportLimitW(line, ctx, 0, mild)).toBeCloseTo(supply);
      line = {
        ...line,
        capacityW: quote.targetCapacityW,
        annualOperatingCost: quote.annualOperatingCost,
      };
      expect(effectiveMarket(line.corridorId, ctx)!.availableDemandW).toBe(5e6);
    }
    expect(intertieUpgradeQuote(line, 2024, 1, 1, ctx)).toBeUndefined();
    expect(intertieImportLimitW(line, ctx, 0, mild)).toBeCloseTo(supply);
  });

  it("allows a wider wire to relieve a bottleneck without creating supply", () => {
    const ctx = context(100);
    const minute = 4 * MINUTES_PER_MONTH;
    const line = { corridorId: "california-north", capacityW: 150e6 };
    expect(neighborImportSupplyW(line.corridorId, ctx, minute, mild)).toBe(
      180e6,
    );
    expect(intertieImportLimitW(line, ctx, minute, mild)).toBe(150e6);
    expect(
      intertieImportLimitW({ ...line, capacityW: 225e6 }, ctx, minute, mild),
    ).toBe(180e6);
    expect(
      intertieImportLimitW({ ...line, capacityW: 500e6 }, ctx, minute, mild),
    ).toBe(180e6);
  });
});

describe("shared neighbor supply and export demand", () => {
  const offers: IntertieOffer[] = [
    {
      marketId: "A",
      importLimitW: 70,
      exportLimitW: 70,
      marketImportLimitW: 100,
      marketExportLimitW: 90,
      pricePerMWh: 60,
    },
    {
      marketId: "A",
      importLimitW: 70,
      exportLimitW: 70,
      marketImportLimitW: 100,
      marketExportLimitW: 90,
      pricePerMWh: 40,
    },
    {
      marketId: "B",
      importLimitW: 80,
      exportLimitW: 80,
      marketImportLimitW: 40,
      marketExportLimitW: 30,
      pricePerMWh: 50,
    },
  ];
  it("exhausts each market only once, in import and export merit order", () => {
    expect(allocateIntertieFlows(offers, Infinity, 0).importedW).toEqual([
      30, 70, 40,
    ]);
    expect(allocateIntertieFlows(offers, 0, Infinity).exportedW).toEqual([
      70, 20, 30,
    ]);
    expect(allocateIntertieFlows(offers, 90, 0).importedW).toEqual([0, 70, 20]);
  });
  it("breaks equal-price ties in stable line order without duplicating the budget", () => {
    const tied = offers
      .slice(0, 2)
      .map((offer) => ({ ...offer, pricePerMWh: 50 }));
    expect(allocateIntertieFlows(tied, 150, 0).importedW).toEqual([70, 30]);
    expect(allocateIntertieFlows(tied, 0, 150).exportedW).toEqual([70, 20]);
  });
});
