import { isUtilityExpansionGame } from "../helpers/ExpansionContext";
import { getScenario } from "./Scenarios";
import type { FrozenStartingIntertieAccessType, GameType } from "../Types";
import { validFrozenStartingIntertieScenario } from "../helpers/FrozenStartingInterties";
import { INTERTIE_UPGRADE_STEP, MAX_INTERTIE_UPGRADES } from "../Constants";
import {
  adjacentMarketForCorridor,
  corridorById,
  corridorsForLocation,
} from "./AdjacentMarkets";
import { corridorOpenInYear } from "./IntertieTrends";
import { log } from "../helpers/Libm";

export interface IntertieAccessContext {
  peers?: NonNullable<GameType["multiplayer"]>["peers"];
  scenarioId?: number;
  frozenStartingIntertieAccess?: FrozenStartingIntertieAccessType;
  locationId?: string;
}
export interface ScenarioIntertieAccess {
  scenarioId: number;
  locationId: string;
  corridorId: string;
  capacityW: number;
  /** Baseline purchased import allocation, also the fallback when no tier schedule is authored. */
  availableSupplyW: number;
  /** Purchased import rights by completed tier, bounded by the regional spare supply. */
  importAccessWByTier?: readonly [number, number, number, number];
  availableDemandW: number;
}
/** Fixed utility access allocations, not the full regional network. Never scale with live demand. */
export const SCENARIO_INTERTIE_ACCESS: readonly ScenarioIntertieAccess[] = [
  ...["vt-champlain-valley", "vt-champlain-ridge"].map((corridorId) => ({
    scenarioId: 116,
    locationId: "BurlingtonVT",
    corridorId,
    capacityW: 100e6,
    availableSupplyW: 40e6,
    importAccessWByTier: [40e6, 60e6, 80e6, 100e6] as const,
    availableDemandW: 80e6,
  })),
  {
    scenarioId: 100,
    locationId: "SF",
    corridorId: "california-north",
    capacityW: 150e6,
    availableSupplyW: 180e6,
    importAccessWByTier: [180e6, 210e6, 240e6, 270e6],
    availableDemandW: 150e6,
  },
  {
    scenarioId: 100,
    locationId: "SF",
    corridorId: "california-south",
    capacityW: 150e6,
    availableSupplyW: 120e6,
    importAccessWByTier: [120e6, 140e6, 160e6, 180e6],
    availableDemandW: 150e6,
  },
  {
    scenarioId: 101,
    locationId: "SF",
    corridorId: "california-north",
    capacityW: 150e6,
    availableSupplyW: 180e6,
    importAccessWByTier: [180e6, 210e6, 240e6, 270e6],
    availableDemandW: 150e6,
  },
  {
    scenarioId: 101,
    locationId: "SF",
    corridorId: "california-south",
    capacityW: 150e6,
    availableSupplyW: 120e6,
    importAccessWByTier: [120e6, 140e6, 160e6, 180e6],
    availableDemandW: 150e6,
  },
  {
    scenarioId: 102,
    locationId: "PIT",
    corridorId: "pjm-miso-upgrade",
    capacityW: 150e6,
    availableSupplyW: 150e6,
    importAccessWByTier: [150e6, 175e6, 200e6, 225e6],
    availableDemandW: 150e6,
  },
  {
    scenarioId: 102,
    locationId: "PIT",
    corridorId: "pjm-nyiso-new",
    capacityW: 100e6,
    availableSupplyW: 100e6,
    importAccessWByTier: [100e6, 120e6, 140e6, 160e6],
    availableDemandW: 100e6,
  },
  {
    scenarioId: 103,
    locationId: "PIT",
    corridorId: "pjm-miso-upgrade",
    capacityW: 150e6,
    availableSupplyW: 150e6,
    importAccessWByTier: [150e6, 175e6, 200e6, 225e6],
    availableDemandW: 150e6,
  },
  {
    scenarioId: 103,
    locationId: "PIT",
    corridorId: "pjm-nyiso-new",
    capacityW: 100e6,
    availableSupplyW: 100e6,
    importAccessWByTier: [100e6, 120e6, 140e6, 160e6],
    availableDemandW: 100e6,
  },
  {
    scenarioId: 106,
    locationId: "Manassas",
    corridorId: "pjm-miso-upgrade",
    capacityW: 30e6,
    availableSupplyW: 25e6,
    importAccessWByTier: [25e6, 30e6, 35e6, 40e6],
    availableDemandW: 30e6,
  },
  {
    scenarioId: 106,
    locationId: "Manassas",
    corridorId: "pjm-nyiso-new",
    capacityW: 20e6,
    availableSupplyW: 15e6,
    importAccessWByTier: [15e6, 20e6, 25e6, 30e6],
    availableDemandW: 20e6,
  },
  {
    scenarioId: 107,
    locationId: "Austin",
    corridorId: "ercot-east-dc-upgrade",
    capacityW: 600e6,
    availableSupplyW: 300e6,
    importAccessWByTier: [300e6, 330e6, 360e6, 390e6],
    availableDemandW: 400e6,
  },
  {
    scenarioId: 107,
    locationId: "Austin",
    corridorId: "ercot-southern-spirit-new",
    capacityW: 1200e6,
    availableSupplyW: 450e6,
    importAccessWByTier: [450e6, 480e6, 510e6, 540e6],
    availableDemandW: 600e6,
  },
  {
    scenarioId: 108,
    locationId: "Madrid",
    corridorId: "spain-portugal-upgrade",
    capacityW: 65e6,
    availableSupplyW: 65e6,
    importAccessWByTier: [65e6, 70e6, 75e6, 80e6],
    availableDemandW: 65e6,
  },
  {
    scenarioId: 108,
    locationId: "Madrid",
    corridorId: "spain-biscay",
    capacityW: 100e6,
    availableSupplyW: 100e6,
    importAccessWByTier: [100e6, 110e6, 120e6, 130e6],
    availableDemandW: 100e6,
  },
  {
    scenarioId: 110,
    locationId: "Paris",
    corridorId: "france-core-upgrade",
    capacityW: 200e6,
    availableSupplyW: 200e6,
    importAccessWByTier: [200e6, 210e6, 220e6, 230e6],
    availableDemandW: 200e6,
  },
  {
    scenarioId: 110,
    locationId: "Paris",
    corridorId: "france-biscay",
    capacityW: 100e6,
    availableSupplyW: 100e6,
    importAccessWByTier: [100e6, 110e6, 120e6, 130e6],
    availableDemandW: 100e6,
  },
  {
    scenarioId: 111,
    locationId: "LA",
    corridorId: "california-north",
    capacityW: 40e6,
    availableSupplyW: 40e6,
    importAccessWByTier: [40e6, 45e6, 50e6, 55e6],
    availableDemandW: 5e6,
  },
  {
    scenarioId: 111,
    locationId: "LA",
    corridorId: "california-south",
    capacityW: 15e6,
    availableSupplyW: 15e6,
    importAccessWByTier: [15e6, 17e6, 19e6, 21e6],
    availableDemandW: 7.5e6,
  },
  {
    scenarioId: 112,
    locationId: "SF",
    corridorId: "california-north",
    capacityW: 500e6,
    availableSupplyW: 500e6,
    importAccessWByTier: [500e6, 550e6, 600e6, 650e6],
    availableDemandW: 500e6,
  },
  {
    scenarioId: 112,
    locationId: "SF",
    corridorId: "california-south",
    capacityW: 750e6,
    availableSupplyW: 300e6,
    importAccessWByTier: [300e6, 330e6, 360e6, 390e6],
    availableDemandW: 750e6,
  },
  {
    scenarioId: 113,
    locationId: "Johannesburg",
    corridorId: "south-africa-mozambique-upgrade",
    capacityW: 6.5e6,
    availableSupplyW: 6e6,
    importAccessWByTier: [6e6, 6.5e6, 7e6, 7.5e6],
    availableDemandW: 6.5e6,
  },
  {
    scenarioId: 113,
    locationId: "Johannesburg",
    corridorId: "south-africa-northwest-upgrade",
    capacityW: 4.5e6,
    availableSupplyW: 2.5e6,
    importAccessWByTier: [2.5e6, 2.75e6, 3e6, 3.25e6],
    availableDemandW: 4.5e6,
  },
  {
    scenarioId: 114,
    locationId: "Lusaka",
    corridorId: "zambia-drc-upgrade",
    capacityW: 70e6,
    availableSupplyW: 70e6,
    importAccessWByTier: [70e6, 75e6, 80e6, 85e6],
    availableDemandW: 70e6,
  },
  {
    scenarioId: 114,
    locationId: "Lusaka",
    corridorId: "zambia-zimbabwe-upgrade",
    capacityW: 90e6,
    availableSupplyW: 90e6,
    importAccessWByTier: [90e6, 95e6, 100e6, 105e6],
    availableDemandW: 90e6,
  },
  {
    scenarioId: 115,
    locationId: "Delhi",
    corridorId: "india-himalaya-upgrade",
    capacityW: 70e6,
    availableSupplyW: 60e6,
    importAccessWByTier: [60e6, 65e6, 70e6, 75e6],
    availableDemandW: 70e6,
  },
  {
    scenarioId: 115,
    locationId: "Delhi",
    corridorId: "india-bangladesh-upgrade",
    capacityW: 70e6,
    availableSupplyW: 25e6,
    importAccessWByTier: [25e6, 30e6, 35e6, 40e6],
    availableDemandW: 100e6,
  },
];
export function accessContextForGame(
  game: Pick<GameType, "scenarioId" | "location" | "customScenario"> &
    Partial<Pick<GameType, "multiplayer">>,
): IntertieAccessContext {
  const custom = game.customScenario;
  return {
    peers: game.multiplayer?.peers,
    scenarioId: isUtilityExpansionGame(game)
      ? 116
      : game.customScenario
        ? undefined
        : game.scenarioId,
    locationId: game.location.id,
    ...(custom?.mod && validFrozenStartingIntertieScenario(custom)
      ? { frozenStartingIntertieAccess: custom.startingIntertieAccess }
      : {}),
  };
}
function allocation(corridorId: string, context?: IntertieAccessContext) {
  if (
    context?.frozenStartingIntertieAccess &&
    context.frozenStartingIntertieAccess.locationId === context.locationId
  )
    return context.frozenStartingIntertieAccess.allocations.find(
      (row) => row.corridorId === corridorId,
    );
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
  const corridor =
    context?.peers?.find((p) => p.corridor.id === corridorId)?.corridor ??
    corridorById(corridorId);
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
  capacityW?: number,
) {
  const market = adjacentMarketForCorridor(corridorId);
  const access = allocation(corridorId, context);
  return market && access
    ? {
        ...market,
        availableSupplyW: Math.min(
          market.availableSupplyW,
          access.importAccessWByTier?.[
            Math.max(
              0,
              Math.min(
                MAX_INTERTIE_UPGRADES,
                Math.round(
                  log((capacityW ?? access.capacityW) / access.capacityW) /
                    log(INTERTIE_UPGRADE_STEP),
                ),
              ),
            )
          ] ?? access.availableSupplyW,
        ),
        availableDemandW: access.availableDemandW,
      }
    : market;
}
/** Corridors that can be ordered this year: their path exists and has not been cut off. */
export function corridorsForGame(
  game: Pick<GameType, "scenarioId" | "location" | "customScenario"> &
    Partial<Pick<GameType, "multiplayer">> & {
      date: Pick<GameType["date"], "year">;
    },
) {
  if (game.multiplayer) {
    const starting =
      getScenario(game.scenarioId, game.customScenario)?.startingInterties ||
      [];
    return [
      ...(game.multiplayer.peers?.map((p) => p.corridor) ?? []),
      ...corridorsForLocation(game.location)
        .filter(
          (c) =>
            starting.includes(c.id) ||
            (isUtilityExpansionGame(game) &&
              ["vt-champlain-valley", "vt-champlain-ridge"].includes(c.id)),
        )
        .map((c) => effectiveCorridor(c.id, accessContextForGame(game))!),
    ];
  }
  return corridorsForLocation(game.location)
    .filter(({ id }) => corridorOpenInYear(id, game.date.year))
    .map((c) => effectiveCorridor(c.id, accessContextForGame(game))!);
}
