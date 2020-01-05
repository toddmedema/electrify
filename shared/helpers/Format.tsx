const numbro = require('numbro');

export function formatWatts(i: number, mantissa = 1): string {
  return numbro(i)
    .format({
      spaceSeparated: false,
      average: true,
      trimMantissa: true,
      totalLength: 2,
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
