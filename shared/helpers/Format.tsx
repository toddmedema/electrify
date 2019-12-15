const numbro = require('numbro');

export function formatWatts(i: number) {
  return numbro(i)
    .format({
      spaceSeparated: false,
      average: true,
      trimMantissa: true,
      mantissa: 1,
    })
    // lowercase k for thousands in both cases
    .replace('m', 'M') // Capitalize MegaWatts
    .replace('b', 'G') // Billions -> Giga
    .replace('t', 'T') // Capitalize TeraWatts
    + 'W';
}

// used for numbers that flicker rapidly to preserve length / visual stability
export function formatMoneyStable(i: number) {
  return numbro(i).format({ average: true, totalLength: 3 }).toUpperCase();
}

export function formatMoneyConcise(i: number) {
  return numbro(i).format({ average: true, totalLength: 3, trimMantissa: true }).toUpperCase();
}
