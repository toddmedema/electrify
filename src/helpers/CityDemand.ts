import type {
  DemandByTypeType,
  GameType,
  TerritoryId,
  TickPresentFutureType,
} from "../Types";
import { getTerritoryDefinition } from "../data/Territories";
import { UTILITY_AREAS } from "../data/UtilityExpansion";
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
  const territory = getTerritoryDefinition(id);
  const utility = Object.values(UTILITY_AREAS).find((area) => area.id === id);
  const reference = utility ?? UTILITY_AREAS.champlain;
  const date = getDateFromMinute(tick.minute, game.startingYear);
  const customers = customerMarketSizeAt(
    utility?.customers ?? territory?.customers ?? 0,
    tick.minute,
  );
  const { baselineW } = areaBaselineDemand(
    date,
    game.location,
    tick.temperatureC,
    customers,
    reference.demandScale *
      (utility ? 1 : (territory?.customerLoadMultiplier ?? 1)),
    reference.demandShapeExponent,
  );
  const energyShares = utility?.energyShares ?? {
    Residential: territory?.benefit === "residential" ? 1 : 0,
    Commercial: 0,
    Industrial: territory?.benefit === "industrial" ? 1 : 0,
  };
  return demandByTypeAt(
    baselineW,
    date,
    game.startingYear,
    game.location,
    [],
    energyShares,
  );
}
