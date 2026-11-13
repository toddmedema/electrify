import { pow } from "./Pow";
import { log10 } from "./Libm";

/** Remove a minus only when the displayed number has rounded to zero. */
export function withoutNegativeZero(formatted: string): string {
  return formatted.replace(
    /^([^0-9−-]*)[−-]([^0-9−-]*)(0+(?:[.,]0+)*)(?=$|[^0-9.,])/,
    "$1$2$3",
  );
}

const numberFormats = new Map<string, Intl.NumberFormat>();

/** Player-facing amounts are compact and never imply more than three significant digits. */
export function formatNumber(
  value: number | bigint,
  options?: Intl.NumberFormatOptions,
): string {
  const maximumSignificantDigits = Math.min(
    options?.maximumSignificantDigits ?? 3,
    3,
  );
  const displayOptions: Intl.NumberFormatOptions = {
    notation: "compact",
    ...options,
    minimumSignificantDigits: Math.min(
      options?.minimumSignificantDigits ?? 1,
      maximumSignificantDigits,
    ),
    maximumSignificantDigits,
  };
  const key = JSON.stringify(displayOptions);
  let formatter = numberFormats.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", displayOptions);
    numberFormats.set(key, formatter);
  }
  return withoutNegativeZero(formatter.format(value)).replace(/K\b/g, "k");
}

/** Estimates use the same presentation rules, with a stricter two-digit ceiling. */
export function formatForecastNumber(value: number): string {
  return formatNumber(value, { maximumSignificantDigits: 2 });
}

/** Shift decimal text so ties retain the display formatter's Math.round convention. */
function roundDisplaySignificant(value: number, digits: 2 | 3): number {
  if (!Number.isFinite(value) || value === 0) return value;
  const [coefficient, exponent] = value.toExponential().split("e");
  const rounded = Math.round(Number(`${coefficient}e${digits - 1}`));
  return Number(`${rounded}e${Number(exponent) - digits + 1}`);
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

/** Choose the coarser limit before rounding, then remove only excess decimal zeroes. */
function formatSignificantDecimal(
  value: number,
  significantDigits: 2 | 3,
  {
    digits,
    trim,
    fixed = false,
  }: { digits: number; trim: boolean; fixed?: boolean },
): string {
  if (!Number.isFinite(value)) return String(value);
  const exponent =
    value === 0 ? 0 : Number(value.toExponential().split("e")[1]);
  const places = Math.min(digits, significantDigits - 1 - exponent);
  const rounded =
    places < 0 ? roundDisplaySignificant(value, significantDigits) : value;
  let amount = fixed
    ? formatFixed(rounded, Math.max(0, places))
    : formatDecimalNumber(rounded, {
        digits: Math.max(0, places),
        trim,
        group: false,
      });
  while (
    amount.includes(".") &&
    amount.endsWith("0") &&
    (trim ||
      amount.replace(/^[^1-9]*/, "").replace(/\D/g, "").length >
        significantDigits)
  ) {
    amount = amount.slice(0, -1).replace(/\.$/, "");
  }
  return amount;
}

/** Compact quantities share the precision and suffixes used by cards and tables. */
export function formatAbbreviatedNumber(
  value: number,
  { totalDigits = 3 } = {},
): string {
  return formatNumber(value, { maximumSignificantDigits: totalDigits });
}

/** Fixed decimals for display, preserving genuine negative values and trailing zeroes. */
export function formatFixed(value: number, digits: number): string {
  return withoutNegativeZero(value.toFixed(digits));
}

/** Electricity prices in cents per kWh, with at most one decimal place. */
export function formatRateCompact(dollarsPerKWh: number): string {
  return `${formatNumber(Number(formatSignificantDecimal(dollarsPerKWh * 100, 3, { digits: 1, trim: true, fixed: true })))}¢`;
}

/**
 * Format power using its actual magnitude, without promoting sub-GW values to GW. Values of 10 or
 * more in their unit are always whole numbers ("541MW"); smaller ones keep one decimal ("9.8GW")
 * or the requested mantissa capped at three significant digits ("1.52kW").
 */
export function formatWatts(i: number, mantissa?: number): string {
  return formatWattsInUnit(i, getWattUnit(i), mantissa);
}

export function formatForecastWatts(i: number): string {
  return formatWattsInUnit(
    i,
    getWattUnit(roundDisplaySignificant(i, 2)),
    undefined,
    2,
  );
}

export function formatForecastWattHours(i: number): string {
  return formatForecastWatts(i) + "h";
}

export function formatForecastWattsAxis(i: number, _ticks: number[]): string {
  return formatForecastWatts(i);
}

export function formatForecastWattHoursAxis(
  i: number,
  _ticks: number[],
): string {
  return formatForecastWattHours(i);
}

export function formatForecastReserveLine(
  reserveW: number,
  label: string,
): string {
  return reserveW < 0
    ? `Shortage: ${formatForecastWatts(-reserveW)}`
    : `${label}: ${formatForecastWatts(reserveW)}`;
}

/**
 * A labelled reserve reading. Negative values are labelled "Shortage". Reserve includes reachable
 * headroom and can differ from unmet demand.
 */
export function formatReserveLine(reserveW: number, label: string): string {
  return reserveW < 0
    ? `Shortage: ${formatWatts(-reserveW)}`
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

export function formatForecastMoney(i: number): string {
  return Number.isFinite(i) ? signedMoney(i, true, 2) : NO_ESTIMATE;
}

/** "-$63.8k": the sign leads the currency, and an amount that rounds to zero carries none. */
function signedMoney(
  i: number,
  trimMantissa: boolean,
  significantDigits: 2 | 3 = 3,
): string {
  const amount = formatMoneyAmount(
    Math.abs(i),
    trimMantissa,
    significantDigits,
  );
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
function formatMoneyAmount(
  i: number,
  trimMantissa: boolean,
  significantDigits: 2 | 3,
): string {
  const abs = Math.abs(i);
  const unit =
    MONEY_UNITS.find((candidate) => abs >= candidate.divisor) ||
    MONEY_UNITS[MONEY_UNITS.length - 1];
  let scaled = i / unit.divisor;
  const scaledAbs = Math.abs(scaled);
  // Rounding 999.9M to 1,000M would violate the chosen tier even though the source value is still
  // below $1B. At that narrow boundary, truncate to the largest valid whole value for the tier.
  if (
    scaledAbs >= (significantDigits === 2 ? 995 : 999.5) &&
    scaledAbs < 1000
  ) {
    scaled = Math.sign(scaled) * (significantDigits === 2 ? 990 : 999);
  }
  const displayAbs = Math.abs(scaled);
  const mantissa =
    displayAbs < 1
      ? 2
      : displayAbs < 10
        ? significantDigits - 1
        : displayAbs < 100
          ? significantDigits - 2
          : 0;
  return (
    formatSignificantDecimal(scaled, significantDigits, {
      digits: mantissa,
      trim: trimMantissa,
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
  significantDigits: 2 | 3 = 3,
): string {
  const scaled = i / unit.divisor;
  const requested = mantissa ?? 1;
  // Every power and energy reading of 10 or more is a whole number, whatever precision a caller
  // asks for; the rounding check uses that precision so 9.96 at one decimal becomes "10", not "10.0"
  const whole = Math.abs(Number(scaled.toFixed(requested))) >= 10;
  return (
    formatSignificantDecimal(scaled, significantDigits, {
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
  return percentWithPrecision(fraction, digits, 3);
}

export function formatForecastPercent(fraction: number): string {
  return percentWithPrecision(fraction, 1, 2).replace(/\.0%$/, "%");
}

function percentWithPrecision(
  fraction: number,
  digits: number,
  significantDigits: 2 | 3,
): string {
  const amount = formatSignificantDecimal(fraction * 100, significantDigits, {
    digits,
    trim: false,
    fixed: digits > 0,
  });
  return `${Math.abs(Number(amount)) >= 1000 ? formatNumber(Number(amount), { maximumSignificantDigits: significantDigits }) : amount}%`;
}

/** Round once to whole numbers or the significant-digit cap, whichever is coarser. */
export function formatCount(n: number, significantDigits: 2 | 3 = 3): string {
  return formatNumber(
    Number(
      formatSignificantDecimal(n, significantDigits, { digits: 0, trim: true }),
    ),
    { maximumSignificantDigits: significantDigits },
  );
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

/** A game score as a compact amount with at most three significant digits. */
export function formatScore(score: number): string {
  return formatCount(score);
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
