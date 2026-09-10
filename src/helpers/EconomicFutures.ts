import { getInflationRate, getPrimeRate, MonthRefType } from "../data/Economy";
import { TREND_ESCALATION_YEARLY } from "../data/FuelPrices";

export const ECONOMIC_FUTURES = [
  {
    id: "lower",
    label: "Lower cost assumption",
    annualFuelGrowth: 0.02,
    primeShift: -0.02,
    inflationShift: -0.01,
  },
  {
    id: "reference",
    label: "Reference assumption",
    annualFuelGrowth: TREND_ESCALATION_YEARLY,
    primeShift: 0,
    inflationShift: 0,
  },
  {
    id: "higher",
    label: "Higher cost assumption",
    annualFuelGrowth: 0.06,
    primeShift: 0.02,
    inflationShift: 0.01,
  },
] as const;

export interface EconomicFutureType {
  id: (typeof ECONOMIC_FUTURES)[number]["id"];
  label: string;
  annualFuelExpense: number;
  annualFuelGrowth: number;
  primeRate: number;
  inflationRate: number;
  yearsAhead: number;
}

/**
 * A price-only sensitivity comparison, not three predictions of the utility's finances.
 * Hold fuel use and the fleet fixed; vary explicitly authored nominal fuel-price trends and
 * macro assumptions. The reference retains the game's 4% trend. The alternatives are not
 * confidence bounds or measured forecasts. None of these rows changes dispatch or loan contracts.
 * EIA likewise uses alternative assumptions to explore uncertainty rather than probabilities:
 * https://www.eia.gov/outlooks/aeo/assumptions/
 */
export function compareEconomicFutures({
  annualFuelExpense,
  date,
  seed,
  yearsAhead = 5,
}: {
  annualFuelExpense: number;
  date: MonthRefType;
  seed: number;
  yearsAhead?: number;
}): EconomicFutureType[] {
  const horizon = Math.max(0, Math.min(50, Math.floor(yearsAhead)));
  const futureDate = {
    year: date.year + horizon,
    monthNumber: date.monthNumber,
  };
  const prime = getPrimeRate(futureDate, seed);
  const inflation = getInflationRate(futureDate, seed);
  // Gradually separate assumptions; their starting values coincide at the quoted present.
  const shiftScale = Math.min(1, horizon / 5);
  return ECONOMIC_FUTURES.map((assumption) => ({
    id: assumption.id,
    label: assumption.label,
    annualFuelExpense:
      Math.max(0, annualFuelExpense) *
      Math.pow(1 + assumption.annualFuelGrowth, horizon),
    annualFuelGrowth: assumption.annualFuelGrowth,
    primeRate: Math.max(
      0,
      Math.min(0.25, prime + assumption.primeShift * shiftScale),
    ),
    inflationRate: Math.max(
      -0.02,
      Math.min(0.15, inflation + assumption.inflationShift * shiftScale),
    ),
    yearsAhead: horizon,
  }));
}
