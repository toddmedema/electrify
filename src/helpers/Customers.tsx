import {
  ORGANIC_GROWTH_MAX_ANNUAL,
  TICK_MINUTES,
  TICKS_PER_MONTH,
  TICKS_PER_YEAR,
} from "../Constants";
import { getInflationIndex } from "../data/Economy";
import { DateType } from "../Types";

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

export interface CustomerTickInputType {
  customers: number;
  customerRate: number;
  marketRate: number;
  marketSize: number;
  ownership: "Investor" | "Public";
  organicGrowthRate?: number;
}

export function updateCustomerRate(
  previousRate: number,
  currentRate: number,
): number {
  const ticksOfMemory = CUSTOMER_RATE_MEMORY_MONTHS * TICKS_PER_MONTH;
  return previousRate + (currentRate - previousRate) / ticksOfMemory;
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
}: CustomerTickInputType): number {
  let change = (customers * organicGrowthRate) / TICKS_PER_YEAR;
  if (ownership === "Investor") {
    const switchingRate = customerSwitchingRate(customerRate, marketRate);
    const switchingBase =
      switchingRate >= 0
        ? Math.max(0, marketSize - customers)
        : Math.max(0, customers);
    change += (switchingBase * switchingRate) / TICKS_PER_YEAR;
  }
  const next = Math.max(0, Math.round(customers + change));
  return ownership === "Investor"
    ? Math.min(Math.round(marketSize), next)
    : next;
}

/** The addressable market grows with the same underlying population trend as neutral customers. */
export function customerMarketSizeAt(
  startingMarketSize: number,
  minute: number,
): number {
  const elapsedYears = minute / TICK_MINUTES / TICKS_PER_YEAR;
  return (
    startingMarketSize * Math.pow(1 + ORGANIC_GROWTH_MAX_ANNUAL, elapsedYears)
  );
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
