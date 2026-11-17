import type {
  DemandByTypeType,
  GameType,
  TerritoryId,
  TickPresentFutureType,
} from "../Types";
import { cityProfile } from "./CityProfiles";
import { demandByTypeAt } from "../data/DemandProfiles";
import { areaBaselineDemand } from "./AreaDemand";
import { customerMarketSizeAt } from "./Customers";
import { getDateFromMinute } from "./DateTime";
import { territoryDemandByType } from "./Territories";

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
