import { LOCATIONS } from "../Constants";
import type { GameType } from "../Types";
import { getDateFromMinute } from "../helpers/DateTime";
import { GENERATORS, STORAGE } from "./Facilities";
import {
  getLegacyBuildBounds,
  isLegacyEraGame,
  legacyCpi,
  legacyFuelPrices,
  LEGACY_HYDRO_INVENTORY_KEY,
} from "./LegacyEra";
import {
  getHydroAvailability,
  getHydroInventoryKey,
  validHydroClaims,
} from "./HydroSites";

function gameAt(year: number, scenarioId = 117): GameType {
  return {
    scenarioId,
    startingYear: year,
    date: getDateFromMinute(0, year),
    difficulty: "CEO",
    seed: 1,
    facilities: [],
    commissionedHydroSiteIds: [],
    monthlyHistory: [],
    location: LOCATIONS.SF,
    feePerKgCO2e: 0,
  } as unknown as GameType;
}

it("quotes a sub-MW early plant with its own scale, heat rate and timing", () => {
  const game = gameAt(1882);
  const quote = GENERATORS(game, 100000, [], []).find(
    (g) => g.name === "Coal",
  )!;
  expect(quote.peakW).toBe(100000);
  expect(quote.maxPeakW).toBe(500000);
  expect(quote.btuPerWh).toBe(138);
  expect(quote.yearsToBuild).toBe(1);
  expect(quote.buildCost).toBeCloseTo(180000);
  expect(quote.annualOperatingCost).toBeCloseTo(30000);
  expect(getLegacyBuildBounds(game)).toEqual({
    minW: 50000,
    defaultW: 100000,
    maxW: 500000,
  });
  const laterQuote = GENERATORS(gameAt(1902), 100000, [], []).find(
    (g) => g.name === "Coal",
  )!;
  expect(laterQuote.btuPerWh).toBeLessThan(quote.btuPerWh);
  expect(quote.btuPerWh).toBe(138);
  expect(getLegacyBuildBounds(gameAt(1902))).toEqual({
    minW: 50000,
    defaultW: 500000,
    maxW: 5000000,
  });
});

it("keeps modern catalogs and custom copies outside trusted era privileges", () => {
  const modern = gameAt(2020, 100);
  const coal = GENERATORS(modern, 100000, [], []).find(
    (g) => g.name === "Coal",
  )!;
  expect(coal.btuPerWh).toBe(8.638);
  expect(getLegacyBuildBounds(modern)).toBeUndefined();
  const copy = { ...gameAt(1882), customScenario: {} } as GameType;
  expect(isLegacyEraGame(copy)).toBe(false);
});

it("gates regional equipment dates and closes new nuclear orders without changing built assets", () => {
  const names = (year: number) =>
    GENERATORS(gameAt(year), 10000000, [], []).map(({ name }) => name);
  expect(names(1949)).not.toContain("Natural Gas Peaker");
  expect(names(1950)).toContain("Natural Gas Peaker");
  expect(names(1959)).not.toContain("Nuclear");
  expect(names(1960)).toContain("Nuclear");
  const reactor = GENERATORS(gameAt(1975), 100000000, [], []).find(
    (g) => g.name === "Nuclear",
  )!;
  expect(reactor.maxPeakW).toBe(100000000);
  expect(names(1976)).not.toContain("Nuclear");
  expect(reactor.btuPerWh).toBe(10.608);
  expect(names(1989)).not.toContain("Natural Gas CC");
  expect(names(1990)).toContain("Natural Gas CC");
  const solar = GENERATORS(gameAt(1983), 1000000, [], []).find(
    (g) => g.name === "Solar",
  )!;
  expect(solar.maxPeakW).toBe(10000000);
  const wind = GENERATORS(gameAt(1982), 1000000, [], []).find(
    (g) => g.name === "Wind",
  )!;
  expect(wind.maxPeakW).toBe(50000000);
  expect(STORAGE(gameAt(1967), 100000000).map((g) => g.name)).not.toContain(
    "Pumped Hydro",
  );
  expect(STORAGE(gameAt(2008), 100000000).map((g) => g.name)).not.toContain(
    "Battery",
  );
});

it("opens only dated campaign hydro sites and permanently retains a commissioned claim", () => {
  const game = gameAt(1882);
  expect(getHydroInventoryKey(game)).toBe(LEGACY_HYDRO_INVENTORY_KEY);
  expect(getHydroAvailability(game, 100000).eligible).toEqual([]);
  game.date = getDateFromMinute(0, 1895);
  const available = getHydroAvailability(game, 750000);
  expect(available.eligible.map(({ maxPeakW }) => maxPeakW)).toEqual([750000]);
  const claimed = available.selected!.id;
  game.commissionedHydroSiteIds = [claimed];
  expect(getHydroAvailability(game, 750000).eligible).toEqual([]);
  expect(validHydroClaims(game)).toBe(true);
  game.date = getDateFromMinute(0, 1882);
  expect(validHydroClaims(game)).toBe(false);
  game.scenarioId = 125;
  game.date = getDateFromMinute(0, 2042);
  expect(
    getHydroAvailability(game, 750000).remaining.map(({ id }) => id),
  ).not.toContain(claimed);
  expect(validHydroClaims(game)).toBe(true);
  game.scenarioId = 100;
  expect(validHydroClaims(game)).toBe(false);
});

it("uses explicit early monetary assumptions and only one authored first oil shock", () => {
  expect(legacyCpi(1882)).toBe(9.9);
  expect(legacyCpi(1975)).toBe(53.8);
  const reference = {
    Coal: 1,
    "Natural Gas": 1,
    Oil: 3,
    Uranium: 0.2,
    Biomass: 1,
  };
  const before = legacyFuelPrices(1973, 9, reference);
  const after = legacyFuelPrices(1973, 10, reference);
  expect(after.Oil).toBeGreaterThan(before.Oil);
  expect(after.Coal).toBe(before.Coal);
  expect(reference.Oil).toBe(3);
});
