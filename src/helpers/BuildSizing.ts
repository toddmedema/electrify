import { FacilityOperatingType, isStorage } from "../Types";
import { pow } from "./Pow";

/** The size the catalog opens at when nothing of that kind has been built yet */
export const DEFAULT_BUILD_SIZE = 500000000;

/**
 * The build catalogs' size slider. Starting at 1M, each tick increments the leading digit, and
 * when it overflows a zero is added instead (1 → 2MW, 9 → 10MW, 10 → 20MW).
 */
export function sliderTickToW(tick: number): number {
  const exponent = Math.floor(tick / 9) + 6;
  const frontNumber = (tick % 9) + 1;
  return frontNumber * pow(10, exponent);
}

/** The inverse of sliderTickToW, rounding down to the tick at or below the size */
export function wToSliderTick(w: number): number {
  const exponent = Math.floor(Math.log10(w)) - 6;
  const frontNumber = +w.toString().charAt(0);
  return frontNumber + exponent * 9 - 1;
}

/**
 * The size of the most recently built generator (peak W) or storage (peak Wh), so the catalog
 * opens where the player last left it.
 */
export function mostRecentBuiltSize(
  facilities: readonly FacilityOperatingType[],
  storage: boolean,
): number {
  let latest: FacilityOperatingType | undefined;
  for (const facility of facilities) {
    if (isStorage(facility) === storage && (!latest || facility.id > latest.id))
      latest = facility;
  }
  if (!latest) return DEFAULT_BUILD_SIZE;
  return (
    (isStorage(latest) ? latest.peakWh : latest.peakW) || DEFAULT_BUILD_SIZE
  );
}
