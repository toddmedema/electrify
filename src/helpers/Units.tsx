import { UnitSystemType } from "../Types";
import { formatCount, formatNumber, formatForecastNumber } from "./Format";

/**
 * Everything the player reads is converted from metric at the last moment; nothing upstream of
 * these functions ever holds an imperial number. The simulation, the saves and the weather data
 * are all metric, so switching systems can only ever change what a label says, never what the
 * game does - which is also why every conversion here is one way, out of metric.
 */

// The order the setting offers them in, and what a stored choice is checked against
export const UNIT_SYSTEMS: readonly UnitSystemType[] = ["metric", "imperial"];
export const DEFAULT_UNIT_SYSTEM: UnitSystemType = "metric";

export const UNIT_SYSTEM_LABELS: { [system in UnitSystemType]: string } = {
  metric: "Metric",
  imperial: "Imperial",
};

// Exact definitions rather than the rounded constants they're usually quoted as
const KG_PER_POUND = 0.45359237;
const KG_PER_SHORT_TON = 907.18474;
const KG_PER_TONNE = 1000;

// The yardstick the score deducts emissions per. A round megatonne, and a lopsided 1.1M tons
export const KG_PER_MEGATONNE = 1000000000;

export function isImperial(units: UnitSystemType): boolean {
  return units === "imperial";
}

export function temperatureUnit(units: UnitSystemType): string {
  return isImperial(units) ? "°F" : "°C";
}

export function toDisplayTemperature(
  celsius: number,
  units: UnitSystemType,
): number {
  return isImperial(units) ? celsius * 1.8 + 32 : celsius;
}

export function formatTemperature(
  celsius: number,
  units: UnitSystemType,
): string {
  return `${formatCount(toDisplayTemperature(celsius, units))}${temperatureUnit(units)}`;
}

export function formatForecastTemperature(
  celsius: number,
  units: UnitSystemType,
): string {
  return `${formatCount(toDisplayTemperature(celsius, units), 2)}${temperatureUnit(units)}`;
}

/** The unit a generator's emissions per MWh are quoted in - small enough to read in whole units */
export function massUnit(units: UnitSystemType): string {
  return isImperial(units) ? "lb" : "kg";
}

/** Spelled out, for prose rather than a table cell */
export function massUnitName(units: UnitSystemType): string {
  return isImperial(units) ? "pounds" : "kilograms";
}

export function toDisplayMass(kg: number, units: UnitSystemType): number {
  return isImperial(units) ? kg / KG_PER_POUND : kg;
}

export function formatMass(kg: number, units: UnitSystemType): string {
  return `${formatCount(toDisplayMass(kg, units))}${massUnit(units)}`;
}

/**
 * Metric tons are spelled "tonnes" so that the two systems' tons can't be mistaken for each
 * other - they're 10% apart, which is exactly the size of difference that reads as a bug.
 */
export function largeMassUnit(units: UnitSystemType): string {
  return isImperial(units) ? "tons" : "tonnes";
}

export function toDisplayLargeMass(kg: number, units: UnitSystemType): number {
  return kg / (isImperial(units) ? KG_PER_SHORT_TON : KG_PER_TONNE);
}

/** Just the number, for a table that puts the unit in its own column or suffix */
export function formatLargeMassValue(
  kg: number,
  units: UnitSystemType,
  _mantissa = 0,
): string {
  return formatNumber(toDisplayLargeMass(kg, units));
}

/**
 * The same value as formatLargeMassValue, but rounded to k/M/B rather than spelled out to the
 * kilogram - for the chart and its sparkline tile, which have room for a compact amount
 * and not the seven a full tonne count runs to.
 */
export function formatLargeMassValueConcise(
  kg: number,
  units: UnitSystemType,
): string {
  return formatLargeMassValue(kg, units);
}

export function formatLargeMass(kg: number, units: UnitSystemType): string {
  return `${formatLargeMassValue(kg, units)} ${largeMassUnit(units)}`;
}

/**
 * A total in k/M/B of the player's ton, rounded to three significant digits ("12.3k tonnes",
 * "1.23B tonnes"), for a headline figure whose last few digits are noise. Rounding comes first so
 * 999,600 reads "1M" rather than "1000k".
 */
export function formatLargeMassSignificant(
  kg: number,
  units: UnitSystemType,
): string {
  return formatLargeMass(kg, units);
}

/**
 * A round number of tons in one system is a lopsided one in the other, so a quantity used as a
 * yardstick - the megatonne the score deducts per, the fee quoted per ton - is rounded to
 * something a player can hold onto rather than shown to the digit.
 */
export function formatLargeMassApprox(
  kg: number,
  units: UnitSystemType,
): string {
  const value = toDisplayLargeMass(kg, units);
  return `${formatForecastNumber(value)} ${largeMassUnit(units)}`;
}

/**
 * A price quoted per metric ton, restated per whatever ton the player is reading in. The stored
 * value stays per kilogram either way - see feePerKgCO2e on the scenario.
 */
export function toDisplayPricePerLargeMass(
  dollarsPerKg: number,
  units: UnitSystemType,
): number {
  return dollarsPerKg * (isImperial(units) ? KG_PER_SHORT_TON : KG_PER_TONNE);
}

export function formatPricePerLargeMass(
  dollarsPerKg: number,
  units: UnitSystemType,
): string {
  return `$${formatCount(toDisplayPricePerLargeMass(dollarsPerKg, units))}/${isImperial(units) ? "ton" : "tonne"}`;
}
