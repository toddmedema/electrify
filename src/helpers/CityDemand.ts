import type {
  DemandByTypeType,
  GameType,
  TerritoryId,
  TickPresentFutureType,
} from "../Types";
import { DAYS_PER_YEAR } from "../Constants";
import type { UtilityEnergyShares } from "../data/UtilityExpansion";
import { cityProfile } from "./CityProfiles";
import { demandByTypeAt } from "../data/DemandProfiles";
import { areaBaselineDemand } from "./AreaDemand";
import { customerMarketSizeAt } from "./Customers";
import { getDateFromMinute } from "./DateTime";
import { territoryDemandByType } from "./Territories";

export type CityGrowthSector = keyof UtilityEnergyShares;

const CITY_GROWTH_SECTORS: readonly CityGrowthSector[] = [
  "Residential",
  "Commercial",
  "Industrial",
];
const GROWTH_SHARE_FOR_BLOCK = 0.05;
// Share all eight sector combinations so a new year with the same development
// keeps the existing scene model.
const CITY_GROWTH_VARIANTS = Array.from(
  { length: 1 << CITY_GROWTH_SECTORS.length },
  (_, sectors) =>
    CITY_GROWTH_SECTORS.filter((_, index) => sectors & (1 << index)),
);

/** Derive visible development from the city's public long-term demand profile. */
export function cityGrowthAt(
  {
    seed,
    startingYear,
    location,
  }: Pick<GameType, "seed" | "startingYear" | "location">,
  year: number,
  id: TerritoryId,
): readonly CityGrowthSector[] {
  if (year <= startingYear) return CITY_GROWTH_VARIANTS[0];
  const profile = cityProfile(seed, id);
  if (!profile) return CITY_GROWTH_VARIANTS[0];

  // Sample the same hour each January. Its daily shape cancels in the ratio
  // and the opening energy share weights each sector against the whole city.
  const { customers, energyShares } = profile;
  const demandAt = (elapsedMinute: number) =>
    demandByTypeAt(
      customerMarketSizeAt(customers, elapsedMinute),
      getDateFromMinute(elapsedMinute, startingYear),
      startingYear,
      location,
      [],
      energyShares,
    );
  const opening = demandAt(0);
  const current = demandAt((year - startingYear) * DAYS_PER_YEAR * 1440);
  const sectors = CITY_GROWTH_SECTORS.reduce((flags, sector, index) => {
    const growthShare =
      energyShares[sector] *
      ((current[sector] - opening[sector]) / opening[sector]);
    return growthShare >= GROWTH_SHARE_FOR_BLOCK ? flags | (1 << index) : flags;
  }, 0);
  return CITY_GROWTH_VARIANTS[sectors];
}

/** Owned cities show allocated company load; other cities use their public regional profile.
 * Inspecting a neighbour never applies our policies to it or adds its demand to our company.
 */
export function cityDemandByType(
  game: GameType,
  tick: TickPresentFutureType,
  id: TerritoryId,
  owned: boolean,
): DemandByTypeType {
  if (owned) return territoryDemandByType(game, tick, id);
  const profile = cityProfile(game.seed, id);
  if (!profile)
    return Object.fromEntries(
      Object.keys(tick.demandByType).map((sector) => [sector, 0]),
    ) as DemandByTypeType;
  const date = getDateFromMinute(tick.minute, game.startingYear);
  const customers = customerMarketSizeAt(profile.customers, tick.minute);
  const { baselineW } = areaBaselineDemand(
    date,
    game.location,
    tick.temperatureC,
    customers,
    profile.demandScale,
    profile.demandShapeExponent,
  );
  return demandByTypeAt(
    baselineW,
    date,
    game.startingYear,
    game.location,
    [],
    profile.energyShares,
  );
}
