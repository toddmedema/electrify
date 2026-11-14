import type { LocationType } from "../Types";
import { CURRENCIES, COUNTRY_CURRENCY_CODES } from "../data/Currencies";

/** All simulation values remain USD. Convert only when producing display text. */
export interface CurrencyType {
  readonly code: string;
  readonly symbol: string;
  readonly unitsPerDollar: number;
}

export const USD_CURRENCY: CurrencyType = CURRENCIES.USD;

export function isCurrencyCode(value: unknown): boolean {
  return typeof value === "string" && Object.hasOwn(CURRENCIES, value);
}

/** Saved display metadata is an allowlisted code, never a caller-supplied exchange rate. */
export function currencyByCode(code?: string): CurrencyType {
  return isCurrencyCode(code)
    ? CURRENCIES[code as keyof typeof CURRENCIES]
    : USD_CURRENCY;
}

/** Current local denomination for every date, except pre-1992 Ukraine's Soviet ruble. */
export function currencyForLocation(
  location?: LocationType,
  startingYear?: number,
): CurrencyType {
  if (
    location?.country === "Ukraine" &&
    startingYear !== undefined &&
    startingYear < 1992
  ) {
    return CURRENCIES.SUR;
  }
  const country = location?.country;
  return country && Object.hasOwn(COUNTRY_CURRENCY_CODES, country)
    ? currencyByCode(COUNTRY_CURRENCY_CODES[country])
    : USD_CURRENCY;
}
