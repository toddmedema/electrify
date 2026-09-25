import numbro from "numbro";

/**
 * Format power using its actual magnitude, without promoting sub-GW values to GW. Unless a
 * mantissa is requested, values of 10 or more in their unit are whole numbers ("541MW") and
 * smaller ones keep one decimal ("9.8GW").
 */
export function formatWatts(i: number, mantissa?: number): string {
  return formatWattsInUnit(i, getWattUnit(i), mantissa);
}

/**
 * Rounds down to two significant digits, so a maximum shown as "1.2GW" is a size that can really
 * be built rather than a rounded-up value just past the limit.
 */
export function floorToTwoSignificantDigits(i: number): number {
  if (!(i > 0) || !Number.isFinite(i)) {
    return 0;
  }
  const step = Math.pow(10, Math.floor(Math.log10(i)) - 1);
  return Math.floor(i / step + 1e-9) * step;
}

export function formatWattHours(i: number, mantissa?: number): string {
  return formatWatts(i, mantissa) + "h";
}

// Costs are derived from division, so a zero denominator reaches the formatters as Infinity or
// NaN. numbro renders those literally -- "$INFINITY/MWh" was showing up on the build screen for a
// generator whose estimated output was zero -- and a dash reads as the "no estimate" it means.
const NO_ESTIMATE = "—";

// used for numbers that flicker rapidly to preserve length / visual stability
export function formatMoneyStable(i: number): string {
  if (!Number.isFinite(i)) {
    return NO_ESTIMATE;
  }
  return "$" + formatMoneyAmount(i, false);
}

export function formatMoneyConcise(i: number): string {
  if (!Number.isFinite(i)) {
    return NO_ESTIMATE;
  }
  return "$" + formatMoneyAmount(i, true);
}

interface MoneyUnitType {
  suffix: string;
  divisor: number;
}

const MONEY_UNITS: MoneyUnitType[] = [
  { suffix: "T", divisor: 1e12 },
  { suffix: "B", divisor: 1e9 },
  { suffix: "M", divisor: 1e6 },
  { suffix: "k", divisor: 1e3 },
  { suffix: "", divisor: 1 },
];

/**
 * Pick units from the amount itself, never from the formatter's desired character count. That
 * keeps $700M as $700M instead of promoting it to $0.70B; a suffix only changes once the amount
 * actually reaches one of the next unit.
 */
function formatMoneyAmount(i: number, trimMantissa: boolean): string {
  const abs = Math.abs(i);
  const unit =
    MONEY_UNITS.find((candidate) => abs >= candidate.divisor) ||
    MONEY_UNITS[MONEY_UNITS.length - 1];
  let scaled = i / unit.divisor;
  const scaledAbs = Math.abs(scaled);
  // Rounding 999.9M to 1,000M would violate the chosen tier even though the source value is still
  // below $1B. At that narrow boundary, truncate to the largest valid whole value for the tier.
  if (scaledAbs >= 999.5 && unit.divisor > 1) {
    scaled = Math.sign(scaled) * 999;
  }
  const displayAbs = Math.abs(scaled);
  const mantissa = displayAbs < 10 ? 2 : displayAbs < 100 ? 1 : 0;
  return (
    numbro(scaled).format({
      mantissa,
      trimMantissa,
      thousandSeparated: false,
    }) + unit.suffix
  );
}

interface WattUnitType {
  suffix: string;
  divisor: number;
}

const WATT_UNITS: WattUnitType[] = [
  { suffix: "T", divisor: 1e12 },
  { suffix: "G", divisor: 1e9 },
  { suffix: "M", divisor: 1e6 },
  { suffix: "k", divisor: 1e3 },
  { suffix: "", divisor: 1 },
];

/** The SI unit selected from the absolute value, before rounding. */
export function getWattUnit(i: number): WattUnitType {
  const abs = Math.abs(i);
  return (
    WATT_UNITS.find((u) => abs >= u.divisor) ||
    WATT_UNITS[WATT_UNITS.length - 1]
  );
}

/**
 * Formats watts in a caller-chosen unit, so that a group of related numbers - axis ticks,
 * a current/peak pair - all read in the same unit instead of each picking its own.
 */
export function formatWattsInUnit(
  i: number,
  unit: WattUnitType,
  mantissa?: number,
): string {
  const scaled = i / unit.divisor;
  return (
    numbro(scaled).format({
      thousandSeparated: true,
      trimMantissa: true,
      mantissa: mantissa ?? (Math.abs(scaled) >= 9.95 ? 0 : 1),
    }) +
    unit.suffix +
    "W"
  );
}

/** Axis values follow the same unit thresholds as cards and tooltips. */
export function formatWattsAxis(t: number, _ticks: number[]): string {
  return formatWatts(t);
}

export function formatWattHoursAxis(t: number, _ticks: number[]): string {
  return formatWattHours(t);
}

/** Share a suffix only when both values naturally use the same unit. */
export function formatWattsOfPeak(current: number, peak: number): string {
  const value = Math.abs(current);
  const peakUnit = getWattUnit(peak);
  const currentUnit = getWattUnit(value);
  const shared = value === 0 || currentUnit.divisor === peakUnit.divisor;
  return shared
    ? formatWattsInUnit(value, peakUnit).replace(/[^0-9.,]/g, "") +
        "/" +
        formatWatts(peak)
    : formatWatts(value) + "/" + formatWatts(peak);
}

export function formatWattHoursOfPeak(current: number, peak: number): string {
  return formatWattsOfPeak(current, peak).replace(/W/g, "Wh");
}

export function formatSignedWattsOfPeak(current: number, peak: number): string {
  const pair = formatWattsOfPeak(current, peak);
  return current < 0 && !/^0(\.0*)?\//.test(pair) ? "-" + pair : pair;
}
