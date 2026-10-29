import { FacilityOperatingType, GameType, isStorage } from "../Types";
import { pow } from "./Pow";
import { log10 } from "./Libm";
import { MAX_INTERTIE_UPGRADES } from "../Constants";
import { corridorsForGame } from "../data/IntertieAccess";
import { intertieBuildQuote, intertieContextForGame } from "./Transmission";
import { purchaseTerms } from "./Financials";

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
  const exponent = Math.floor(log10(w)) - 6;
  const frontNumber = +w.toString().charAt(0);
  return frontNumber + exponent * 9 - 1;
}

/** Slider sizes plus the exact technology/site limit used by the catalog's resize shortcut. */
export function buildSizeOptions(
  minTick: number,
  maxTick: number,
  limit: number,
): number[] {
  const sizes = Array.from({ length: maxTick - minTick + 1 }, (_, index) =>
    sliderTickToW(minTick + index),
  ).filter((size) => size <= limit);
  if (
    sizes.length &&
    limit < sliderTickToW(maxTick) &&
    sizes[sizes.length - 1] !== limit
  )
    sizes.push(limit);
  return sizes;
}

/** Find the largest offered size whose loan downpayment fits the player's cash. Quotes own costs. */
export function largestAffordableBuildSize(
  sizes: readonly number[],
  cash: number,
  buildCost: (size: number) => number,
): number | undefined {
  let low = 0;
  let high = sizes.length - 1;
  let affordable: number | undefined;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (purchaseTerms(buildCost(sizes[middle]), true, 0).downpayment <= cash) {
      affordable = sizes[middle];
      low = middle + 1;
    } else high = middle - 1;
  }
  return affordable;
}

/** Average installed capacity of this kind; the workspace remembers later slider choices. */
export function averageBuildSize(
  facilities: readonly FacilityOperatingType[],
  storage: boolean,
): number {
  const sizes = facilities
    .filter((facility) => isStorage(facility) === storage)
    .map((facility) => (isStorage(facility) ? facility.peakWh : facility.peakW))
    .filter((size) => Number.isFinite(size) && size > 0);
  if (sizes.length)
    return sizes.reduce((sum, size) => sum + size, 0) / sizes.length;
  // A first storage project holds four hours of an average generator's output, like a battery.
  if (storage && facilities.some((facility) => !isStorage(facility)))
    return averageBuildSize(facilities, false) * 4;
  return DEFAULT_BUILD_SIZE;
}

/** Choose the available tier whose average project capacity is nearest the current grid. */
export function initialIntertieBuildTier(game: GameType): number {
  const lines = game.transmission?.lines ?? [];
  const target = lines.length
    ? lines.reduce((sum, line) => sum + line.capacityW, 0) / lines.length
    : averageBuildSize(game.facilities, false);
  const corridors = corridorsForGame(game).filter(
    ({ id }) => !lines.some(({ corridorId }) => corridorId === id),
  );
  const context = intertieContextForGame(game);
  let bestTier = 1;
  let bestDistance = Infinity;
  for (let tier = 1; tier <= MAX_INTERTIE_UPGRADES + 1; tier++) {
    const quotes = corridors
      .map(({ id }) => intertieBuildQuote(id, game.date.year, tier, context))
      .filter((quote) => quote !== undefined);
    if (!quotes.length) continue;
    const average =
      quotes.reduce((sum, quote) => sum + quote.capacityW, 0) / quotes.length;
    const distance = Math.abs(average - target);
    if (distance < bestDistance) {
      bestTier = tier;
      bestDistance = distance;
    }
  }
  return bestTier;
}
