import type {
  FacilityOperatingType,
  FuelNameType,
  GameType,
  WorldEventEffectsType,
} from "../Types";
import { getInflationIndex, hasEconomy } from "../data/Economy";
import { RETROFIT_COST_MULTIPLIER } from "../data/Hazards";

/** Targeted protection, in 2020 dollars per MW; see docs/winterization.md. */
const RETROFIT_DOLLARS_PER_MW = {
  "Natural Gas": 3000,
  Coal: 3000,
  Uranium: 3000,
  Wind: 62000,
} as const;
export type WinterizationFuel = keyof typeof RETROFIT_DOLLARS_PER_MW;
export function isWinterizationFuel(fuel: unknown): fuel is WinterizationFuel {
  return (
    typeof fuel === "string" &&
    Object.prototype.hasOwnProperty.call(RETROFIT_DOLLARS_PER_MW, fuel)
  );
}

/** A completed installation stays on its asset, including in a future forecast. */
export function hasWinterization(
  facility: Partial<
    Pick<FacilityOperatingType, "resilience" | "upgradeInProgress">
  >,
  minute: number,
): boolean {
  return (
    !!facility.resilience?.coldWeatherPackage ||
    (facility.upgradeInProgress?.upgrade === "coldWeatherPackage" &&
      facility.upgradeInProgress.completesMinute <= minute)
  );
}

/** Capacity-based price, independent of difficulty or the plant's replacement value. */
export function winterizationPrice(
  facility: { fuel?: FuelNameType; peakW: number },
  game: Pick<GameType, "date" | "startingYear" | "seed">,
  builtIn = false,
): number {
  if (!isWinterizationFuel(facility.fuel)) return 0;
  const anchor = Math.min(2020, game.startingYear);
  const inflation = hasEconomy()
    ? getInflationIndex(game.date, anchor, game.seed) /
      getInflationIndex({ year: 2020, monthNumber: 1 }, anchor, game.seed)
    : 1;
  return Math.round(
    ((facility.peakW / 1e6) *
      RETROFIT_DOLLARS_PER_MW[facility.fuel] *
      inflation) /
      (builtIn ? RETROFIT_COST_MULTIPLIER : 1),
  );
}

/** Preserve cold losses separately from unrelated outages so protection cannot soften either. */
export function winterizationEffects(
  effects: WorldEventEffectsType,
): WorldEventEffectsType {
  const result = {
    ...effects,
    winterizationOutputMultipliersByFuel:
      effects.winterizationOutputMultipliersByFuel ??
      effects.facilityOutputMultipliersByFuel,
  };
  delete result.facilityOutputMultipliersByFuel;
  return result;
}
