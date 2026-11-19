// Representative construction years, from early U.S. utility adoption through the late
// dedicated gas-steam builds at Permskaya. See docs/facilities-economics.md for sources.
export function gasSteamMaxPeakW(year: number): number {
  if (year < 1925 || year > 1990) return 0;
  return year < 1942 ? 100000000 : 1000000000;
}

// Btu/Wh on an HHV basis. The early steam points use utility steam fleet history as a proxy;
// peaker points represent successive commercial turbine vintages, not the surviving fleet.
const GAS_HEAT_RATE_BY_VINTAGE = {
  steam: [
    [1925, 20],
    [1942, 16.5],
    [1954, 12.2],
    [1970, 10.5],
  ],
  simple: [
    [1941, 20],
    [1957, 17.5],
    [1970, 14.7],
    [1980, 13.3],
    [1990, 11],
    [2019, 9.905],
    [2023, 9.142],
  ],
} as const;

export function gasHeatRate(
  vintageYear: number,
  cycle: keyof typeof GAS_HEAT_RATE_BY_VINTAGE,
): number {
  const anchors = GAS_HEAT_RATE_BY_VINTAGE[cycle];
  for (let i = 0; i < anchors.length; i++) {
    const [year, rate] = anchors[i];
    if (vintageYear === year || (i === 0 && vintageYear < year)) return rate;
    if (vintageYear < year) {
      const [previousYear, previousRate] = anchors[i - 1];
      const fraction = (vintageYear - previousYear) / (year - previousYear);
      return previousRate + fraction * (rate - previousRate);
    }
  }
  return anchors[anchors.length - 1][1];
}
