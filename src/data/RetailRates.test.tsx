import { getFuelEscalation, inEraMoney } from "./FuelPrices";
import { getRetailRateIndex, inEraRate } from "./RetailRates";

describe("getRetailRateIndex", () => {
  it("is exactly 1 in the money base year", () => {
    expect(getRetailRateIndex(2020)).toBe(1);
  });

  it("follows the recorded national average before 2020", () => {
    expect(getRetailRateIndex(1980)).toBeCloseTo(4.7 / 10.59, 10);
    expect(getRetailRateIndex(2000)).toBeCloseTo(6.81 / 10.59, 10);
  });

  it("holds the earliest record for years before it", () => {
    expect(getRetailRateIndex(1960)).toBe(getRetailRateIndex(1975));
  });

  it("follows the projected fuel trend after 2020", () => {
    expect(getRetailRateIndex(2080)).toBeCloseTo(
      getFuelEscalation(2080) / getFuelEscalation(2020),
      10,
    );
  });
});

describe("inEraRate", () => {
  it("quotes a 1980 rate at 1980's prices rather than 2020's", () => {
    expect([0.05, 0.07, 0.1, 0.15].map((r) => inEraRate(r, 1980))).toEqual([
      0.022, 0.031, 0.044, 0.067,
    ]);
  });

  it("keeps the exact amount when the years agree", () => {
    expect(inEraRate(0.0712345, 2020)).toBe(0.0712345);
    expect(inEraRate(0.025, 1980, 1980)).toBe(0.025);
  });

  it("matches inEraMoney for future eras", () => {
    expect(inEraRate(0.07, 2080)).toBe(inEraMoney(0.07, 2080));
  });

  it("converts from a historical source year", () => {
    expect(inEraRate(0.025, 2020, 1980)).toBe(0.056);
  });
});
