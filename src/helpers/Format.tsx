import { pow } from "./Pow";
import { log10 } from "./Libm";

/** Remove a minus only when the displayed number has rounded to zero. */
export function withoutNegativeZero(formatted: string): string {
  return formatted.replace(
    /^([^0-9−-]*)[−-]([^0-9−-]*)(0+(?:[.,]0+)*)(?=$|[^0-9.,])/,
    "$1$2$3",
  );
}

/** Locale-formatted UI numbers share the same zero-sign rule after rounding. */
export function formatNumber(
  value: number,
  options?: Intl.NumberFormatOptions,
): string {
  return withoutNegativeZero(value.toLocaleString("en-US", options));
}

const decimalFormats = new Map<string, Intl.NumberFormat>();

/** Decimal display rounding follows Math.round, including negative ties rounding toward zero. */
export function formatDecimalNumber(
  value: number,
  { digits = 0, trim = false, group = true } = {},
): string {
  if (!Number.isFinite(value)) return String(value);
  // Shift the decimal text rather than multiplying: 1.005 * 100 is just below 100.5.
  const [decimal, exponent] = value.toString().split("e");
  const shifted = Number(`${decimal}e${Number(exponent || 0) + digits}`);
  // Keep the existing truncation of tiny exponential values and avoid overflowing large ones.
  const rounded =
    exponent && Number(exponent) > 0
      ? value
      : (exponent ? Math.trunc(shifted) : Math.round(shifted)) /
        pow(10, digits);
  const key = `${digits}:${trim}:${group}`;
  let formatter = decimalFormats.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: trim ? 0 : digits,
      maximumFractionDigits: digits,
      useGrouping: group,
    });
    decimalFormats.set(key, formatter);
  }
  return withoutNegativeZero(formatter.format(rounded));
}

const ABBREVIATIONS = [
  { divisor: 1e12, suffix: "t" },
  { divisor: 1e9, suffix: "b" },
  { divisor: 1e6, suffix: "m" },
  { divisor: 1e3, suffix: "k" },
];

/** Compact historical quantities promote a unit from its halfway point, as before. */
export function formatAbbreviatedNumber(
  value: number,
  { digits = 0, totalDigits = 0 } = {},
): string {
  if (!Number.isFinite(value)) return String(value);
  const unit = ABBREVIATIONS.find(
    ({ divisor }) => Math.abs(value) >= divisor / 2,
  );
  const scaled = unit ? value / unit.divisor : value;
  const integerDigits =
    Math.abs(scaled) < 1 ? 0 : Math.abs(scaled).toString().split(".")[0].length;
  return (
    formatDecimalNumber(scaled, {
      digits: totalDigits ? Math.max(totalDigits - integerDigits, 0) : digits,
      trim: true,
      group: false,
    }) + (unit?.suffix ?? "")
  );
}

/** Fixed decimals for display, preserving genuine negative values and trailing zeroes. */
export function formatFixed(value: number, digits: number): string {
  return withoutNegativeZero(value.toFixed(digits));
}

/** Electricity prices in cents per kWh, with at most one decimal place. */
export function formatRateCompact(dollarsPerKWh: number): string {
  return `${Number(formatFixed(dollarsPerKWh * 100, 1))}¢`;
}

/**
 * Format power using its actual magnitude, without promoting sub-GW values to GW. Values of 10 or
 * more in their unit are always whole numbers ("541MW"); smaller ones keep one decimal ("9.8GW")
 * or the requested mantissa ("1.521kW").
 */
export function formatWatts(i: number, mantissa?: number): string {
  return formatWattsInUnit(i, getWattUnit(i), mantissa);
}

/**
 * A labelled reserve reading. Reserve below zero is a shortfall, so it is named and shown as one
 * ("Shortfall: 8MW") rather than as a negative reserve ("Reserve margin: -8MW").
 */
export function formatReserveLine(reserveW: number, label: string): string {
  return reserveW < 0
    ? `Shortfall: ${formatWatts(-reserveW)}`
    : `${label}: ${formatWatts(reserveW)}`;
}

/**
 * Rounds down to two significant digits, so a maximum shown as "1.2GW" is a size that can really
 * be built rather than a rounded-up value just past the limit.
 */
export function floorToTwoSignificantDigits(i: number): number {
  if (!(i > 0) || !Number.isFinite(i)) {
    return 0;
  }
  const step = pow(10, Math.floor(log10(i)) - 1);
  return Math.floor(i / step + 1e-9) * step;
}

export function formatWattHours(i: number, mantissa?: number): string {
  return formatWatts(i, mantissa) + "h";
}

// Costs are derived from division, so a zero denominator reaches the formatters as Infinity or
// NaN. Rendering those literally put "$INFINITY/MWh" on the build screen for a
// generator whose estimated output was zero -- and a dash reads as the "no estimate" it means.
const NO_ESTIMATE = "—";

// used for numbers that flicker rapidly to preserve length / visual stability
export function formatMoneyStable(i: number): string {
  if (!Number.isFinite(i)) {
    return NO_ESTIMATE;
  }
  return signedMoney(i, false);
}

export function formatMoneyConcise(i: number): string {
  if (!Number.isFinite(i)) {
    return NO_ESTIMATE;
  }
  return signedMoney(i, true);
}

/** "-$63.8k": the sign leads the currency, and an amount that rounds to zero carries none. */
function signedMoney(i: number, trimMantissa: boolean): string {
  const amount = formatMoneyAmount(Math.abs(i), trimMantissa);
  return (i < 0 && /[1-9]/.test(amount) ? "-$" : "$") + amount;
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
    formatDecimalNumber(scaled, {
      digits: mantissa,
      trim: trimMantissa,
      group: false,
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
  const requested = mantissa ?? 1;
  // Every power and energy reading of 10 or more is a whole number, whatever precision a caller
  // asks for; the rounding check uses that precision so 9.96 at one decimal becomes "10", not "10.0"
  const whole = Math.abs(Number(scaled.toFixed(requested))) >= 10;
  return (
    formatDecimalNumber(scaled, {
      digits: whole ? 0 : requested,
      trim: true,
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

/** A 0-1 fraction as a whole (or `digits`-decimal) percentage: 0.456 → "46%". */
export function formatPercent(fraction: number, digits = 0): string {
  return digits > 0
    ? `${formatFixed(fraction * 100, digits)}%`
    : `${Math.round(fraction * 100)}%`;
}

/** A whole count with thousands separators, independent of the browser's locale. */
export function formatCount(n: number): string {
  return formatNumber(Math.round(n));
}

/** A dollar amount per megawatt-hour, in the concise money style: "$42.5/MWh". */
export function formatPricePerMWh(dollarsPerMWh: number): string {
  return `${formatMoneyConcise(dollarsPerMWh)}/MWh`;
}

/** A facility's size: energy capacity for storage, rated output for a generator. */
export function formatFacilitySize(facility: {
  peakW: number;
  peakWh?: number;
}): string {
  // The same test as isStorage, which can't narrow this structural shape
  return facility.peakWh !== undefined
    ? formatWattHours(facility.peakWh)
    : formatWatts(facility.peakW);
}

/** A construction time in whole months: "18 mo" or "18 months". */
export function formatBuildMonths(
  yearsToBuild: number,
  style: "short" | "long" = "short",
): string {
  const months = Math.round(yearsToBuild * 12);
  return `${months} ${style === "short" ? "mo" : "months"}`;
}

/** A game score as a whole number with thousands separators. */
export function formatScore(score: number): string {
  return formatDecimalNumber(score);
}

/** Compact customer counts, with separate precision for chart axes and inspection. */
export function formatCustomerCount(
  value: number,
  significantDigits = 3,
): string {
  return formatNumber(value, {
    notation: "compact",
    maximumSignificantDigits: significantDigits,
  });
}
