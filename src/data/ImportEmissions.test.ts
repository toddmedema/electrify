import {
  ADJACENT_MARKETS,
  TRANSMISSION_CORRIDORS,
  adjacentMarketForCorridor,
} from "./AdjacentMarkets";
import {
  importEmissionsAssumption,
  importEmissionsKgco2ePerMWh,
} from "./ImportEmissions";
import {
  INTERTIE_CORRIDOR_YEARS,
  INTERTIE_MARKET_TRENDS,
} from "./IntertieTrendData";
import {
  corridorOpenInYear,
  intertiePriceIndex,
  seriesAt,
} from "./IntertieTrends";
import { TREND_ESCALATION_YEARLY } from "./FuelPrices";
import { FUELS } from "../Constants";

it("gives every neighboring market a sourced, year-by-year proxy", () => {
  for (const market of ADJACENT_MARKETS) {
    const trend = INTERTIE_MARKET_TRENDS[market.id];
    expect(trend).toBeDefined();
    for (const series of [trend.emissions, trend.prices]) {
      expect(series.length).toBeGreaterThan(1);
      for (const [year, value] of series) {
        expect(Number.isInteger(year)).toBe(true);
        expect(value).toBeGreaterThan(0);
      }
      const years = series.map(([year]) => year);
      expect(new Set(years).size).toBe(years.length);
      expect(years).toEqual([...years].sort((a, b) => a - b));
    }
    expect(trend.emissions[0][0]).toBeLessThanOrEqual(2000);
    expect(trend.emissions.at(-1)![0]).toBeGreaterThanOrEqual(2030);
    expect(market.emissionsBasis).toMatch(/proxy/);
    expect(market.emissionsSource).toMatch(/^https:\/\//);
  }
  expect(importEmissionsAssumption("unmeasured").emissionsBasis).toContain(
    "not measured",
  );
  expect(importEmissionsKgco2ePerMWh("unmeasured", 2024)).toBe(445);
});

it("dates every corridor to when its real path could first carry power", () => {
  for (const corridor of TRANSMISSION_CORRIDORS) {
    const [from, until = Infinity] = INTERTIE_CORRIDOR_YEARS[corridor.id];
    expect(Number.isInteger(from)).toBe(true);
    expect(until).toBeGreaterThan(from);
    expect(corridorOpenInYear(corridor.id, from - 1)).toBe(false);
    expect(corridorOpenInYear(corridor.id, from)).toBe(true);
    expect(corridorOpenInYear(corridor.id, until)).toBe(
      !Number.isFinite(until),
    );
  }
  expect(corridorOpenInYear("unknown", 1980)).toBe(true);
});

it("retains sourced neighboring differences without calling hydro zero-carbon", () => {
  const quebec = adjacentMarketForCorridor("ny-quebec-upgrade")!.id;
  const northwest = adjacentMarketForCorridor("california-north")!.id;
  const himalaya = "geo-delhi-himalayan-hydro-market";
  for (const year of [1990, 2024, 2050]) {
    expect(importEmissionsKgco2ePerMWh(quebec, year)).toBeGreaterThan(0);
    expect(importEmissionsKgco2ePerMWh(quebec, year)).toBeLessThan(
      importEmissionsKgco2ePerMWh(northwest, year),
    );
    expect(importEmissionsKgco2ePerMWh(himalaya, year)).toBeLessThan(50);
  }
});

it("lets a neighbor's mix change over a run", () => {
  const germany = "geo-warsaw-western-core";
  expect(importEmissionsKgco2ePerMWh(germany, 1990)).toBeGreaterThan(
    importEmissionsKgco2ePerMWh(germany, 2024),
  );
  expect(importEmissionsKgco2ePerMWh(germany, 2024)).toBeGreaterThan(
    importEmissionsKgco2ePerMWh(germany, 2050),
  );
  // Fractional years interpolate between anchors rather than stepping on New Year's Day
  const emissions = INTERTIE_MARKET_TRENDS[germany].emissions;
  const [[fromYear], [toYear]] = [emissions[1], emissions[2]];
  const mid = (fromYear + toYear) / 2;
  expect(importEmissionsKgco2ePerMWh(germany, mid)).toBeCloseTo(
    (seriesAt(emissions, fromYear) + seriesAt(emissions, toYear)) / 2,
  );
});

it("scales authored base prices by the researched price shape", () => {
  for (const market of ADJACENT_MARKETS) {
    let reference = 0;
    for (let year = 2019; year <= 2024; year++) {
      reference += intertiePriceIndex(market.id, year) / 6;
    }
    expect(reference).toBeCloseTo(1, 6);
    // Projections are real 2024 dollars, escalated as the game's fuel trend is
    const real2050 =
      seriesAt(INTERTIE_MARKET_TRENDS[market.id].prices, 2050) /
      seriesAt(INTERTIE_MARKET_TRENDS[market.id].prices, 2051);
    expect(
      intertiePriceIndex(market.id, 2051) / intertiePriceIndex(market.id, 2050),
    ).toBeCloseTo((1 + TREND_ESCALATION_YEARLY) / real2050, 6);
    expect(intertiePriceIndex(market.id, 1980)).toBeGreaterThan(0);
  }
  expect(intertiePriceIndex("unmeasured", 1990)).toBe(1);
});

it("compares fuel energy with a consistent combustion CO2 boundary", () => {
  expect(FUELS.Coal.kgCO2ePerBtu * 1000000).toBeCloseTo(93.24);
  expect(FUELS["Natural Gas"].kgCO2ePerBtu * 1000000).toBeCloseTo(52.91);
  expect(FUELS.Oil.kgCO2ePerBtu * 1000000).toBeCloseTo(74.14);
  expect(FUELS.Biomass.kgCO2ePerBtu * 1000000).toBeCloseTo(195 * 0.45359237, 2);
  expect(FUELS.Biomass.kgCO2ePerBtu).toBeGreaterThan(
    FUELS["Natural Gas"].kgCO2ePerBtu,
  );
});
