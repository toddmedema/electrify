import {
  adjacentMarketForCorridor,
  TRANSMISSION_CORRIDORS,
} from "../data/AdjacentMarkets";
import {
  INTERTIE_ARCHETYPES,
  IntertieArchetypeType,
} from "../data/IntertieArchetypes";
import { TickPresentFutureType } from "../Types";
import { MINUTES_PER_MONTH } from "./DateTime";
import {
  adjacentMarketPricePerMWh,
  intertieImportLimitW,
  IntertieContext,
} from "./Transmission";

/**
 * What an intertie is likely to deliver and cost over a typical year. The build cards and the
 * connection details read it from here, and it calls the same per-tick functions the simulation
 * does, so the card can never tell a different story from what happens once the line is built.
 */

type OutlookTick = Pick<
  TickPresentFutureType,
  "minute" | "demandW" | "temperatureC" | "solarIrradianceWM2"
>;

export type DayPeriod = "overnight" | "morning" | "midday" | "evening";

export interface IntertieOutlook {
  archetype: IntertieArchetypeType;
  /** Jan..Dec, 0..1 typical share of the line's capacity the neighbour can fill with imports */
  monthly: number[];
  mean: number;
  lowMonth: number; // 0..11
  /** The same share averaged over your highest-demand forecast hours */
  atPeak: number;
  /** $/MWh */
  priceLow: number; // 10th percentile
  priceMedian: number;
  priceHigh: number; // 90th percentile
  /** Undefined when no time of day stands out, eg a neighbour priced the same around the clock */
  cheapestPeriod?: DayPeriod;
  priciestPeriod?: DayPeriod;
}

/** The share of forecast ticks, by local demand, that counts as "your peak" */
const PEAK_TICK_SHARE = 0.05;
/** How far a time of day's average must sit from the daily average before it is worth naming */
const PERIOD_PRICE_THRESHOLD_PER_MWH = 2;

export function dayPeriod(minute: number): DayPeriod {
  const hour = Math.floor((minute % 1440) / 60);
  if (hour >= 22 || hour < 6) return "overnight";
  if (hour < 10) return "morning";
  if (hour < 16) return "midday";
  return "evening";
}

const DAY_PERIODS: DayPeriod[] = ["overnight", "morning", "midday", "evening"];

function percentile(sorted: number[], fraction: number): number {
  const position = (sorted.length - 1) * fraction;
  const below = Math.floor(position);
  const above = Math.min(sorted.length - 1, below + 1);
  return sorted[below] + (sorted[above] - sorted[below]) * (position - below);
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * A typical calendar year for the line, January to December, averaged over every forecast year
 * that contains each month. Undefined until the forecast covers all twelve months.
 */
export function intertieOutlook(
  corridorId: string,
  context: IntertieContext,
  timeline: readonly OutlookTick[],
  nowMinute = -Infinity,
): IntertieOutlook | undefined {
  const market = adjacentMarketForCorridor(corridorId);
  const corridor = TRANSMISSION_CORRIDORS.find(({ id }) => id === corridorId);
  if (!market || !corridor || corridor.capacityW <= 0) return undefined;
  const ticks = timeline.filter((tick) => tick.minute >= nowMinute);
  const line = { corridorId, capacityW: corridor.capacityW };
  // Average luck, not this run's next wet/dry years: most lines take years to build, and a
  // "typical year" that shifted every January would describe the dice rather than the neighbour.
  const typical = { ...context, expectedLuck: true };

  const shares: number[] = [];
  const prices: number[] = [];
  const months: number[][] = Array.from({ length: 12 }, () => []);
  const periods = new Map<DayPeriod, number[]>(
    DAY_PERIODS.map((period) => [period, []]),
  );
  ticks.forEach((tick) => {
    const share =
      intertieImportLimitW(line, typical, tick.minute, tick) /
      corridor.capacityW;
    const price = adjacentMarketPricePerMWh(
      corridorId,
      typical,
      tick.minute,
      tick,
    );
    shares.push(share);
    prices.push(price);
    months[Math.floor(tick.minute / MINUTES_PER_MONTH) % 12].push(share);
    periods.get(dayPeriod(tick.minute))!.push(price);
  });
  if (months.some((month) => !month.length)) return undefined;

  const monthly = months.map(average);
  const lowMonth = monthly.reduce(
    (low, value, month) => (value < monthly[low] ? month : low),
    0,
  );

  const peakCount = Math.max(1, Math.round(ticks.length * PEAK_TICK_SHARE));
  const atPeak = average(
    ticks
      .map((tick, index) => ({ demandW: tick.demandW, index }))
      .sort((a, b) => b.demandW - a.demandW || a.index - b.index)
      .slice(0, peakCount)
      .map(({ index }) => shares[index]),
  );

  const sortedPrices = [...prices].sort((a, b) => a - b);
  const dailyPrice = average(prices);
  const periodPrices = DAY_PERIODS.filter(
    (period) => periods.get(period)!.length,
  ).map((period) => ({ period, price: average(periods.get(period)!) }));
  const cheapest = periodPrices.reduce((a, b) => (b.price < a.price ? b : a));
  const priciest = periodPrices.reduce((a, b) => (b.price > a.price ? b : a));

  return {
    archetype: INTERTIE_ARCHETYPES[market.archetype],
    monthly,
    mean: average(monthly),
    lowMonth,
    atPeak,
    priceLow: percentile(sortedPrices, 0.1),
    priceMedian: percentile(sortedPrices, 0.5),
    priceHigh: percentile(sortedPrices, 0.9),
    cheapestPeriod:
      dailyPrice - cheapest.price >= PERIOD_PRICE_THRESHOLD_PER_MWH
        ? cheapest.period
        : undefined,
    priciestPeriod:
      priciest.price - dailyPrice >= PERIOD_PRICE_THRESHOLD_PER_MWH
        ? priciest.period
        : undefined,
  };
}

/** "Cheapest midday · priciest evening", or undefined when the price barely moves by the hour */
export function pricePeriodCaption(
  outlook: Pick<IntertieOutlook, "cheapestPeriod" | "priciestPeriod">,
): string | undefined {
  const parts = [
    outlook.cheapestPeriod && `cheapest ${outlook.cheapestPeriod}`,
    outlook.priciestPeriod && `priciest ${outlook.priciestPeriod}`,
  ].filter(Boolean) as string[];
  if (!parts.length) return undefined;
  const text = parts.join(" · ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
