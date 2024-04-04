const numbro = require('numbro');

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
  return numbro(i)
    .format({
      spaceSeparated: false,
      average: true,
      trimMantissa: true,
      totalLength: Math.max(2, mantissa),
      mantissa,
    })
    // lowercase k for thousands in both cases
    .replace('m', 'M') // Capitalize MegaWatts
    .replace('b', 'G') // Billions -> Giga
    .replace('t', 'T') // Capitalize TeraWatts
    + 'W';
}

export function formatWattHours(i: number, mantissa = 1): string {
  return formatWatts(i, mantissa) + 'h';
}

// used for numbers that flicker rapidly to preserve length / visual stability
export function formatMoneyStable(i: number): string {
  return '$' + numbro(i).format({ average: true, totalLength: 3 }).toUpperCase();
}

export function formatMoneyConcise(i: number): string {
  return '$' + numbro(i).format({ average: true, totalLength: 3, trimMantissa: true }).toUpperCase();
}
