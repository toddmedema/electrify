import type { GameType } from "../Types";
import {
  adjacentMarketForCorridor,
  corridorById,
  corridorsForLocation,
} from "./AdjacentMarkets";

export interface IntertieAccessContext {
  scenarioId?: number;
  locationId?: string;
}
export interface ScenarioIntertieAccess {
  scenarioId: number;
  locationId: string;
  corridorId: string;
  capacityW: number;
  availableSupplyW: number;
  availableDemandW: number;
}
/** Fixed utility access allocations, not the full regional network. Never scale with live demand. */
export const SCENARIO_INTERTIE_ACCESS: readonly ScenarioIntertieAccess[] = [
  {
    scenarioId: 100,
    locationId: "SF",
    corridorId: "california-north",
    capacityW: 150e6,
    availableSupplyW: 180e6,
    availableDemandW: 150e6,
  },
  {
    scenarioId: 100,
    locationId: "SF",
    corridorId: "california-south",
    capacityW: 150e6,
    availableSupplyW: 120e6,
    availableDemandW: 150e6,
  },
  {
    scenarioId: 101,
    locationId: "SF",
    corridorId: "california-north",
    capacityW: 150e6,
    availableSupplyW: 180e6,
    availableDemandW: 150e6,
  },
  {
    scenarioId: 101,
    locationId: "SF",
    corridorId: "california-south",
    capacityW: 150e6,
    availableSupplyW: 120e6,
    availableDemandW: 150e6,
  },
  {
    scenarioId: 102,
    locationId: "PIT",
    corridorId: "pjm-miso-upgrade",
    capacityW: 150e6,
    availableSupplyW: 150e6,
    availableDemandW: 150e6,
  },
  {
    scenarioId: 102,
    locationId: "PIT",
    corridorId: "pjm-nyiso-new",
    capacityW: 100e6,
    availableSupplyW: 100e6,
    availableDemandW: 100e6,
  },
  {
    scenarioId: 103,
    locationId: "PIT",
    corridorId: "pjm-miso-upgrade",
    capacityW: 150e6,
    availableSupplyW: 150e6,
    availableDemandW: 150e6,
  },
  {
    scenarioId: 103,
    locationId: "PIT",
    corridorId: "pjm-nyiso-new",
    capacityW: 100e6,
    availableSupplyW: 100e6,
    availableDemandW: 100e6,
  },
  {
    scenarioId: 106,
    locationId: "Manassas",
    corridorId: "pjm-miso-upgrade",
    capacityW: 30e6,
    availableSupplyW: 25e6,
    availableDemandW: 30e6,
  },
  {
    scenarioId: 106,
    locationId: "Manassas",
    corridorId: "pjm-nyiso-new",
    capacityW: 20e6,
    availableSupplyW: 15e6,
    availableDemandW: 20e6,
  },
  {
    scenarioId: 107,
    locationId: "Austin",
    corridorId: "ercot-east-dc-upgrade",
    capacityW: 600e6,
    availableSupplyW: 300e6,
    availableDemandW: 400e6,
  },
  {
    scenarioId: 107,
    locationId: "Austin",
    corridorId: "ercot-southern-spirit-new",
    capacityW: 1200e6,
    availableSupplyW: 450e6,
    availableDemandW: 600e6,
  },
  {
    scenarioId: 108,
    locationId: "Madrid",
    corridorId: "spain-portugal-upgrade",
    capacityW: 65e6,
    availableSupplyW: 65e6,
    availableDemandW: 65e6,
  },
  {
    scenarioId: 108,
    locationId: "Madrid",
    corridorId: "spain-biscay",
    capacityW: 100e6,
    availableSupplyW: 100e6,
    availableDemandW: 100e6,
  },
  {
    scenarioId: 110,
    locationId: "Paris",
    corridorId: "france-core-upgrade",
    capacityW: 200e6,
    availableSupplyW: 200e6,
    availableDemandW: 200e6,
  },
  {
    scenarioId: 110,
    locationId: "Paris",
    corridorId: "france-biscay",
    capacityW: 100e6,
    availableSupplyW: 100e6,
    availableDemandW: 100e6,
  },
  {
    scenarioId: 111,
    locationId: "LA",
    corridorId: "california-north",
    capacityW: 5e6,
    availableSupplyW: 4e6,
    availableDemandW: 5e6,
  },
  {
    scenarioId: 111,
    locationId: "LA",
    corridorId: "california-south",
    capacityW: 7.5e6,
    availableSupplyW: 5e6,
    availableDemandW: 7.5e6,
  },
  {
    scenarioId: 112,
    locationId: "SF",
    corridorId: "california-north",
    capacityW: 500e6,
    availableSupplyW: 500e6,
    availableDemandW: 500e6,
  },
  {
    scenarioId: 112,
    locationId: "SF",
    corridorId: "california-south",
    capacityW: 750e6,
    availableSupplyW: 300e6,
    availableDemandW: 750e6,
  },
  {
    scenarioId: 113,
    locationId: "Johannesburg",
    corridorId: "south-africa-mozambique-upgrade",
    capacityW: 6.5e6,
    availableSupplyW: 6e6,
    availableDemandW: 6.5e6,
  },
  {
    scenarioId: 113,
    locationId: "Johannesburg",
    corridorId: "south-africa-northwest-upgrade",
    capacityW: 4.5e6,
    availableSupplyW: 2.5e6,
    availableDemandW: 4.5e6,
  },
  {
    scenarioId: 114,
    locationId: "Lusaka",
    corridorId: "zambia-drc-upgrade",
    capacityW: 70e6,
    availableSupplyW: 70e6,
    availableDemandW: 70e6,
  },
  {
    scenarioId: 114,
    locationId: "Lusaka",
    corridorId: "zambia-zimbabwe-upgrade",
    capacityW: 90e6,
    availableSupplyW: 90e6,
    availableDemandW: 90e6,
  },
  {
    scenarioId: 115,
    locationId: "Delhi",
    corridorId: "india-himalaya-upgrade",
    capacityW: 70e6,
    availableSupplyW: 60e6,
    availableDemandW: 70e6,
  },
  {
    scenarioId: 115,
    locationId: "Delhi",
    corridorId: "india-bangladesh-upgrade",
    capacityW: 70e6,
    availableSupplyW: 25e6,
    availableDemandW: 100e6,
  },
];
export function accessContextForGame(
  game: Pick<GameType, "scenarioId" | "location" | "customScenario">,
): IntertieAccessContext {
  return {
    scenarioId: game.customScenario ? undefined : game.scenarioId,
    locationId: game.location.id,
  };
}
function allocation(corridorId: string, context?: IntertieAccessContext) {
  return SCENARIO_INTERTIE_ACCESS.find(
    (row) =>
      row.scenarioId === context?.scenarioId &&
      row.locationId === context?.locationId &&
      row.corridorId === corridorId,
  );
}
export function effectiveCorridor(
  corridorId: string,
  context?: IntertieAccessContext,
) {
  const corridor = corridorById(corridorId);
  const access = allocation(corridorId, context);
  return corridor && access
    ? {
        ...corridor,
        capacityW: access.capacityW,
        buildCost: (corridor.buildCost * access.capacityW) / corridor.capacityW,
        annualOperatingCost:
          (corridor.annualOperatingCost * access.capacityW) /
          corridor.capacityW,
      }
    : corridor;
}
export function effectiveMarket(
  corridorId: string,
  context?: IntertieAccessContext,
) {
  const market = adjacentMarketForCorridor(corridorId);
  const access = allocation(corridorId, context);
  return market && access
    ? {
        ...market,
        availableSupplyW: access.availableSupplyW,
        availableDemandW: access.availableDemandW,
      }
    : market;
}
export function corridorsForGame(
  game: Pick<GameType, "scenarioId" | "location" | "customScenario">,
) {
  return corridorsForLocation(game.location).map((c) =>
    effectiveCorridor(c.id, accessContextForGame(game))!,
  );
}
