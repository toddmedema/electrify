import {
  getEconomyProvenance,
  getPrimeRate,
  initEconomyFromCsv,
} from "../data/Economy";
import {
  getFuelPriceProvenance,
  initFuelPricesFromCsv,
} from "../data/FuelPrices";
import { compareEconomicFutures } from "./EconomicFutures";

beforeEach(() => {
  initEconomyFromCsv("month,year,prime,inflation\n12,2019,5,0.025");
  initFuelPricesFromCsv(
    "month,year,naturalgas,coal,uranium,oil\n12,2019,3,2,1,8",
  );
});

it("distinguishes the recorded series from modeled future prices and rates", () => {
  expect(getFuelPriceProvenance({ year: 1970, monthNumber: 1 })).toBe(
    "modeled",
  );
  expect(getEconomyProvenance({ year: 1970, monthNumber: 1 })).toBe("modeled");
  expect(getFuelPriceProvenance({ year: 2019, monthNumber: 11 })).toBe(
    "modeled",
  );
  expect(getFuelPriceProvenance({ year: 2019, monthNumber: 12 })).toBe(
    "historical",
  );
  expect(getFuelPriceProvenance({ year: 2020, monthNumber: 1 })).toBe(
    "modeled",
  );
  expect(getEconomyProvenance({ year: 2019, monthNumber: 12 })).toBe(
    "historical",
  );
  expect(getEconomyProvenance({ year: 2020, monthNumber: 1 })).toBe("modeled");
});

it("preserves the historical 1980 prime-rate peak at a zero horizon", () => {
  initEconomyFromCsv("month,year,prime,inflation\n12,1980,21.5,0.135");
  const rows = compareEconomicFutures({
    annualFuelExpense: 100,
    date: { year: 1980, monthNumber: 12 },
    seed: 1,
    yearsAhead: 0,
  });
  expect(rows.map((row) => row.primeRate)).toEqual([0.215, 0.215, 0.215]);
});

it("compares three stated fuel-price assumptions with fixed fuel use", () => {
  const rows = compareEconomicFutures({
    annualFuelExpense: 1_000_000,
    date: { year: 2020, monthNumber: 1 },
    seed: 42,
  });
  expect(rows.map((row) => row.annualFuelExpense)).toEqual(
    [1.02, 1.04, 1.06].map((growth) => 1_000_000 * growth ** 5),
  );
  expect(rows[0].primeRate).toBeLessThan(rows[1].primeRate);
  expect(rows[2].primeRate).toBeGreaterThan(rows[1].primeRate);
  expect(rows[0].inflationRate).toBeLessThan(rows[1].inflationRate);
  expect(rows[2].inflationRate).toBeGreaterThan(rows[1].inflationRate);
});

it("does not change historical observations or the base forecast when comparing alternatives", () => {
  const futureDate = { year: 2040, monthNumber: 1 };
  const before = getPrimeRate(futureDate, 42);
  const request = {
    annualFuelExpense: 100,
    date: { year: 2019, monthNumber: 12 },
    seed: 42,
    yearsAhead: 0,
  };
  const rows = compareEconomicFutures(request);
  expect(rows.map((row) => row.annualFuelExpense)).toEqual([100, 100, 100]);
  expect(rows.map((row) => row.primeRate)).toEqual([0.05, 0.05, 0.05]);
  expect(compareEconomicFutures(request)).toEqual(rows);
  expect(getPrimeRate(futureDate, 42)).toBe(before);
  expect(getEconomyProvenance(futureDate)).toBe("modeled");
});

it("keeps a fuel-free fleet at zero under every cost assumption", () => {
  expect(
    compareEconomicFutures({
      annualFuelExpense: 0,
      date: { year: 2020, monthNumber: 1 },
      seed: 1,
    }).map((row) => row.annualFuelExpense),
  ).toEqual([0, 0, 0]);
});
