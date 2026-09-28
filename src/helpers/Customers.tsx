import {
  ORGANIC_GROWTH_MAX_ANNUAL,
  TICK_MINUTES,
  TICKS_PER_MONTH,
  TICKS_PER_YEAR,
} from "../Constants";
import { getInflationIndex } from "../data/Economy";
import { DateType } from "../Types";
import { pow } from "./Pow";

/** A new investor starts with half of the customers it could eventually serve. */
export const CUSTOMER_MARKET_MULTIPLIER = 2;

/**
 * Customers remember roughly a quarter's worth of bills instead of reacting to the last slider
 * movement. An exponential average makes a changed rate about 63% visible after this many months.
 */
export const CUSTOMER_RATE_MEMORY_MONTHS = 3;

// A ten-percent price advantage moves fifteen percent of the available market in a year. The cap
// keeps extreme rates from making a mature utility disappear or double in a single season.
export const CUSTOMER_PRICE_ELASTICITY = 1.5;
export const CUSTOMER_SWITCHING_MAX_ANNUAL = 0.3;

/** The competitor benchmark follows the same cumulative inflation as the utility's costs. */
export function getMarketRate(
  startingRate: number,
  date: Pick<DateType, "year" | "monthNumber">,
  startingYear: number,
  seed: number,
): number {
  return startingRate * getInflationIndex(date, startingYear, seed);
}

/**
 * A public utility's customers cannot switch away, so its board caps the rate instead: at most
 * this multiple of the authored target rate, carried forward by the same inflation index the
 * score deflates by. Investors face the competitor benchmark rather than a cap.
 */
export const PUBLIC_RATE_CAP_MULTIPLE = 2;
/** The cap never falls below a nickel, so tiny authored targets still leave a usable slider. */
export const PUBLIC_RATE_CAP_FLOOR = 0.05;

export function publicRateCap(
  targetRate: number,
  date: Pick<DateType, "year" | "monthNumber">,
  startingYear: number,
  seed: number,
): number {
  const cap =
    targetRate *
    PUBLIC_RATE_CAP_MULTIPLE *
    getInflationIndex(date, startingYear, seed);
  // Rounded up to whole cents so the slider ends on a clean mark and never below the exact cap
  return Math.max(PUBLIC_RATE_CAP_FLOOR, Math.ceil(cap * 100 - 1e-9) / 100);
}

export interface CustomerTickInputType {
  customers: number;
  customerRate: number;
  marketRate: number;
  marketSize: number;
  ownership: "Investor" | "Public";
  organicGrowthRate?: number;
  tickScale?: number;
}

export function updateCustomerRate(
  previousRate: number,
  currentRate: number,
  tickScale = 1,
): number {
  const ticksOfMemory = CUSTOMER_RATE_MEMORY_MONTHS * TICKS_PER_MONTH;
  if (tickScale === 1) {
    return previousRate + (currentRate - previousRate) / ticksOfMemory;
  }
  const retained = pow(1 - 1 / ticksOfMemory, tickScale);
  return previousRate + (currentRate - previousRate) * (1 - retained);
}

/** Annual fraction of the relevant customer pool that switches to or from the company. */
export function customerSwitchingRate(
  customerRate: number,
  marketRate: number,
): number {
  if (marketRate <= 0) {
    return 0;
  }
  const priceAdvantage = (marketRate - customerRate) / marketRate;
  return Math.max(
    -CUSTOMER_SWITCHING_MAX_ANNUAL,
    Math.min(
      CUSTOMER_SWITCHING_MAX_ANNUAL,
      priceAdvantage * CUSTOMER_PRICE_ELASTICITY,
    ),
  );
}

/**
 * Advances the customer count by one game tick. Investor gains come out of the unserved market,
 * while losses come out of the company's own base; public utilities have captive territories and
 * therefore skip price switching. Organic growth and blackout attrition share the existing annual
 * growth-rate input.
 */
export function nextCustomerCount({
  customers,
  customerRate,
  marketRate,
  marketSize,
  ownership,
  organicGrowthRate = ORGANIC_GROWTH_MAX_ANNUAL,
  tickScale = 1,
}: CustomerTickInputType): number {
  let change = (customers * organicGrowthRate * tickScale) / TICKS_PER_YEAR;
  if (ownership === "Investor") {
    const switchingRate = customerSwitchingRate(customerRate, marketRate);
    const switchingBase =
      switchingRate >= 0
        ? Math.max(0, marketSize - customers)
        : Math.max(0, customers);
    change += (switchingBase * switchingRate * tickScale) / TICKS_PER_YEAR;
  }
  // Preserve fractional customers between ticks: rounding here erases small utilities' growth.
  const next = Math.max(0, customers + change);
  return ownership === "Investor" ? Math.min(marketSize, next) : next;
}

/** The addressable market grows with the same underlying population trend as neutral customers. */
export function customerMarketSizeAt(
  startingMarketSize: number,
  minute: number,
): number {
  const elapsedYears = minute / TICK_MINUTES / TICKS_PER_YEAR;
  return startingMarketSize * pow(1 + ORGANIC_GROWTH_MAX_ANNUAL, elapsedYears);
}

/**
 * The most customers a utility could have after `months`, assuming the best case every month:
 * full organic growth and, for an investor, winning the maximum switching share of the unserved
 * market. Public utilities have captive territories, so organic growth is their only path back.
 * Used to tell when a retention objective can no longer be met.
 */
export function bestReachableCustomers(
  customers: number,
  months: number,
  ownership: "Investor" | "Public",
  marketSize = customers,
): number {
  // The live model adds annual growth / ticks per year on each tick. Continuous
  // compounding bounds that growth from above; taking the twelfth root of (1 + growth)
  // underestimates it and can end a recoverable run.
  const monthlyGrowth = Math.exp(ORGANIC_GROWTH_MAX_ANNUAL / 12);
  let best = customers;
  let market = marketSize;
  for (let month = 0; month < months; month++) {
    best *= monthlyGrowth;
    market *= monthlyGrowth;
    if (ownership === "Investor") {
      best = Math.min(
        market,
        best +
          (Math.max(0, market - best) * CUSTOMER_SWITCHING_MAX_ANNUAL) / 12,
      );
    }
  }
  return best;
}

export interface CustomerProjectionInputType {
  customers: number;
  customerRate: number;
  currentRate: number;
  marketRateAt: (tick: number) => number;
  marketSizeAt: (tick: number) => number;
  ownership: "Investor" | "Public";
  ticks?: number;
}

/** Uses the exact tick rules to preview a rate change without running the electricity simulation. */
export function projectCustomerChange({
  customers,
  customerRate,
  currentRate,
  marketRateAt,
  marketSizeAt,
  ownership,
  ticks = TICKS_PER_MONTH,
}: CustomerProjectionInputType): number {
  const startingCustomers = customers;
  let perceivedRate = customerRate;
  for (let tick = 0; tick < ticks; tick++) {
    perceivedRate = updateCustomerRate(perceivedRate, currentRate);
    customers = nextCustomerCount({
      customers,
      customerRate: perceivedRate,
      marketRate: marketRateAt(tick),
      marketSize: marketSizeAt(tick),
      ownership,
    });
  }
  return customers - startingCustomers;
}
