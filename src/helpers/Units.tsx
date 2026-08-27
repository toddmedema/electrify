import numbro from "numbro";
import { UnitSystemType } from "../Types";

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
const KM_PER_MILE = 1.609344;
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
  return `${Math.round(toDisplayTemperature(celsius, units))}${temperatureUnit(units)}`;
}

export function speedUnit(units: UnitSystemType): string {
  return isImperial(units) ? "mph" : "km/h";
}

export function toDisplaySpeed(kph: number, units: UnitSystemType): number {
  return isImperial(units) ? kph / KM_PER_MILE : kph;
}

export function formatSpeed(kph: number, units: UnitSystemType): string {
  return `${Math.round(toDisplaySpeed(kph, units))} ${speedUnit(units)}`;
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
  return `${Math.round(toDisplayMass(kg, units)).toLocaleString()}${massUnit(units)}`;
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
  mantissa = 0,
): string {
  return numbro(toDisplayLargeMass(kg, units)).format({
    thousandSeparated: true,
    mantissa,
  });
}

/**
 * The same value as formatLargeMassValue, but rounded to K/M/etc rather than spelled out to the
 * kilogram - for the chart and its sparkline tile, which have room for three or four characters
 * and not the seven a full tonne count runs to.
 */
export function formatLargeMassValueConcise(
  kg: number,
  units: UnitSystemType,
): string {
  return numbro(toDisplayLargeMass(kg, units))
    .format({ average: true, totalLength: 3, trimMantissa: true })
    .toUpperCase();
}

export function formatLargeMass(kg: number, units: UnitSystemType): string {
  return `${formatLargeMassValue(kg, units)} ${largeMassUnit(units)}`;
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
  return `${numbro(value).format({ average: true, totalLength: 2, trimMantissa: true }).toUpperCase()} ${largeMassUnit(units)}`;
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
  return `$${Math.round(toDisplayPricePerLargeMass(dollarsPerKg, units)).toLocaleString("en-US")}/${isImperial(units) ? "ton" : "tonne"}`;
}
