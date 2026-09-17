import { ADJACENT_MARKETS, adjacentMarketForCorridor } from "./AdjacentMarkets";
import { importEmissionsAssumption } from "./ImportEmissions";
import { FUELS } from "../Constants";

it("uses a disclosed nonzero source proxy for every neighboring market", () => {
  for (const market of ADJACENT_MARKETS) {
    expect(Number.isFinite(market.emissionsKgco2ePerMWh)).toBe(true);
    expect(market.emissionsKgco2ePerMWh).toBeGreaterThan(0);
    expect(market.emissionsBasis).toMatch(/proxy/);
    expect(market.emissionsSource).toMatch(/^https:\/\//);
  }
  expect(importEmissionsAssumption("unmeasured")).toMatchObject({
    emissionsKgco2ePerMWh: 445,
    emissionsBasis: expect.stringContaining("not measured"),
  });
});

it("retains sourced neighboring differences without calling hydro zero-carbon", () => {
  const quebec = adjacentMarketForCorridor("ny-quebec-upgrade")!;
  const northwest = adjacentMarketForCorridor("california-north")!;
  expect(quebec.emissionsKgco2ePerMWh).toBe(1.2);
  expect(northwest.emissionsKgco2ePerMWh).toBeCloseTo(249 * 0.45359237);
  expect(quebec.emissionsKgco2ePerMWh).toBeLessThan(
    northwest.emissionsKgco2ePerMWh,
  );
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
