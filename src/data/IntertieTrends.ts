import { TREND_ESCALATION_YEARLY } from "./FuelPrices";
import {
  INTERTIE_CORRIDOR_YEARS,
  INTERTIE_MARKET_TRENDS,
  IntertieMarketTrendType,
  YearSeries,
} from "./IntertieTrendData";

/**
 * How a neighbour's grid changes over a run. The researched series in IntertieTrendData carry
 * each market's generation carbon intensity and wholesale price from about 1990 to 2050, so a
 * 1990 game imports that decade's coal-heavy power and a 2045 game imports a cleaner mix.
 *
 * Prices in the record are nominal U.S. dollars through LAST_PRICE_RECORD_YEAR and real 2024
 * dollars in the projections after it. The authored `basePricePerMWh` remains the gameplay
 * calibration, so the series only supplies its shape: the price index is 1 across the
 * PRICE_REFERENCE years the base prices were written for.
 */
export const LAST_PRICE_RECORD_YEAR = 2024;
const PRICE_REFERENCE_FIRST_YEAR = 2019;
const PRICE_REFERENCE_LAST_YEAR = 2024;

/** Linear between anchors, flat beyond either end. */
export function seriesAt(series: YearSeries, year: number): number {
  if (year <= series[0][0]) return series[0][1];
  for (let i = 1; i < series.length; i++) {
    const [toYear, to] = series[i];
    if (year <= toYear) {
      const [fromYear, from] = series[i - 1];
      return from + ((to - from) * (year - fromYear)) / (toYear - fromYear);
    }
  }
  return series[series.length - 1][1];
}

export function intertieMarketTrend(
  marketId: string,
): IntertieMarketTrendType | undefined {
  return INTERTIE_MARKET_TRENDS[marketId];
}

/** Year's own money: the record before 1990 or so is deflated, projections are escalated. */
function nominalPriceAt(prices: YearSeries, year: number): number {
  const [firstYear, first] = prices[0];
  if (year < firstYear) {
    return first / Math.pow(1 + TREND_ESCALATION_YEARLY, firstYear - year);
  }
  const real = seriesAt(prices, year);
  return year > LAST_PRICE_RECORD_YEAR
    ? real *
        Math.pow(1 + TREND_ESCALATION_YEARLY, year - LAST_PRICE_RECORD_YEAR)
    : real;
}

const priceReferences = new Map<string, number>();
function priceReference(marketId: string, prices: YearSeries): number {
  let reference = priceReferences.get(marketId);
  if (reference === undefined) {
    let sum = 0;
    for (
      let year = PRICE_REFERENCE_FIRST_YEAR;
      year <= PRICE_REFERENCE_LAST_YEAR;
      year++
    ) {
      sum += seriesAt(prices, year);
    }
    reference =
      sum / (PRICE_REFERENCE_LAST_YEAR - PRICE_REFERENCE_FIRST_YEAR + 1);
    priceReferences.set(marketId, reference);
  }
  return reference;
}

/**
 * Multiplier on a market's authored base price in a given year: its researched price that year
 * over its 2019-2024 average. Unresearched markets and ids stay at 1.
 */
export function intertiePriceIndex(marketId: string, year: number): number {
  const prices = INTERTIE_MARKET_TRENDS[marketId]?.prices;
  if (!prices?.length) return 1;
  return nominalPriceAt(prices, year) / priceReference(marketId, prices);
}

/** Whether a corridor could be ordered in a year: its path existed and had not been cut off. */
export function corridorOpenInYear(corridorId: string, year: number): boolean {
  const years = INTERTIE_CORRIDOR_YEARS[corridorId];
  if (!years) return true;
  const [from, until] = years;
  return year >= from && (until === undefined || year < until);
}

export function corridorAvailableFromYear(corridorId: string): number {
  return INTERTIE_CORRIDOR_YEARS[corridorId]?.[0] ?? -Infinity;
}
