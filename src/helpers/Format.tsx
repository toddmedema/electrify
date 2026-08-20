const numbro = require("numbro");

/**
 * This function formats a number representing watts into a string with appropriate units.
 * It uses the numbro library to format the number with a specified mantissa and a maximum length of max(2, mantissa).
 * The function also replaces certain characters to use the correct abbreviations for MegaWatts, GigaWatts, and TeraWatts.
 * The result is appended with 'W' to indicate watts.
 *
 * @param {number} i - The number to be formatted.
 * @param {number} mantissa - The number of significant digits to display after the decimal point. Default is 1.
 * @returns {string} - The formatted string representing the number in watts with appropriate units.
 */
export function formatWatts(i: number, mantissa = 1): string {
  return (
    numbro(i)
      .format({
        spaceSeparated: false,
        average: true,
        trimMantissa: true,
        totalLength: Math.max(2, mantissa),
        mantissa,
      })
      // lowercase k for thousands in both cases
      .replace("m", "M") // Capitalize MegaWatts
      .replace("b", "G") // Billions -> Giga
      .replace("t", "T") + // Capitalize TeraWatts
    "W"
  );
}

export function formatWattHours(i: number, mantissa = 1): string {
  return formatWatts(i, mantissa) + "h";
}

// used for numbers that flicker rapidly to preserve length / visual stability
export function formatMoneyStable(i: number): string {
  return (
    "$" + numbro(i).format({ average: true, totalLength: 3 }).toUpperCase()
  );
}

export function formatMoneyConcise(i: number): string {
  return (
    "$" +
    numbro(i)
      .format({ average: true, totalLength: 3, trimMantissa: true })
      .toUpperCase()
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

/**
 * The unit a value of this magnitude reads most naturally in, eg 5e8 -> MegaWatts.
 * Unlike formatWatts this never promotes to the next unit to save a digit
 * (formatWatts renders 500MW as "0.5GW"), so a set of related numbers can share one unit.
 */
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
  mantissa = 1
): string {
  return (
    numbro(i / unit.divisor).format({
      thousandSeparated: true,
      trimMantissa: true,
      mantissa,
    }) +
    unit.suffix +
    "W"
  );
}

/**
 * tickFormat for a watts axis. Victory calls tickFormat with (tick, index, ticks), so every
 * tick is rendered in the unit of the largest one - no more "0.5GW / 400MW / 300MW" axes.
 */
export function formatWattsAxis(t: number, ticks: number[]): string {
  return formatWattsInUnit(t, getWattUnit(Math.max(...ticks.map(Math.abs))));
}

export function formatWattHoursAxis(t: number, ticks: number[]): string {
  return formatWattsAxis(t, ticks) + "h";
}

/**
 * A current-out-of-peak pair sharing the peak's unit, eg "356/500MW" rather than "356/0.5GW".
 */
export function formatWattsOfPeak(current: number, peak: number): string {
  const unit = getWattUnit(peak);
  // A current well below the peak's unit would round away at one decimal, eg 100MW of a 1GW peak
  const mantissa = Math.abs(current) >= unit.divisor ? 1 : 2;
  return (
    formatWattsInUnit(current, unit, mantissa).replace(/[^0-9.,]/g, "") +
    "/" +
    formatWattsInUnit(peak, unit)
  );
}

export function formatWattHoursOfPeak(current: number, peak: number): string {
  return formatWattsOfPeak(current, peak) + "h";
}
