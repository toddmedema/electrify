import { GENERATORS, getBuildFacilityQuote, STORAGE } from "../data/Facilities";
import type {
  FacilityShoppingType,
  GeneratorShoppingType,
  StorageShoppingType,
  GameType,
  TerritoryTileId,
} from "../Types";
import { isStorage } from "../Types";
import { tilePurchaseQuotes, territoryBuildAvailability } from "./Territories";
import {
  getTerritoryTile,
  ownsTerritoryTile,
  tileFitsFacility,
  territoryTileInventory,
  getTerritoryTiles,
  hasTerritoryNetwork,
  territoryTilePowerLimit,
  tileSupportsFacilityTechnology,
} from "./TerritoryTiles";
import { currentTick } from "./GameSelectors";
import { facilityLoanMonths, purchaseTerms } from "./Financials";
import { getDateFromMinute } from "./DateTime";
import { TICK_MINUTES, YEARS_PER_TICK } from "../Constants";

/** Only identity, options and size survive a site change; prices are always resolved again. */
export type ProjectSelection =
  | (Pick<
      GeneratorShoppingType,
      "name" | "fuel" | "peakW" | "gasCycle" | "resilience"
    > & { peakWh?: undefined })
  | (Pick<StorageShoppingType, "name" | "peakW" | "peakWh"> & {
      fuel?: undefined;
      gasCycle?: undefined;
      resilience?: undefined;
    });
export const selectProject = (
  facility: FacilityShoppingType,
): ProjectSelection =>
  isStorage(facility)
    ? { name: facility.name, peakW: facility.peakW, peakWh: facility.peakWh }
    : {
        name: facility.name,
        fuel: facility.fuel,
        peakW: facility.peakW,
        gasCycle: facility.gasCycle,
        resilience: facility.resilience,
      };

export function projectCatalogue(
  game: GameType,
  size: number,
  storage: boolean,
): FacilityShoppingType[] {
  const options = storage
    ? STORAGE(game, size)
    : GENERATORS(game, size, [], []);
  return withTerritoryCatalogueLimits(game, options);
}

/** Catalogue-only ceilings leave canonical economics and retained-facility expansion quotes intact. */
export function withTerritoryCatalogueLimits(
  game: GameType,
  options: FacilityShoppingType[],
): FacilityShoppingType[] {
  if (!hasTerritoryNetwork(game)) return options;
  const tiles = getTerritoryTiles(game);
  return options.map((facility) => {
    // A technology preview must offer a size that can fit a map tile. A selected site's
    // quote applies its own (possibly lower) allowance, ownership and vacancy afterward.
    const maxPowerW = Math.max(
      0,
      ...tiles
        .filter((tile) => tileSupportsFacilityTechnology(tile, facility))
        .map((tile) => territoryTilePowerLimit(tile, facility)),
    );
    return isStorage(facility)
      ? {
          ...facility,
          maxPeakWh: Math.min(
            facility.maxPeakWh,
            (maxPowerW * facility.peakWh) / facility.peakW,
          ),
        }
      : {
          ...facility,
          // The ordinary catalogue only knows owned hydro sites. Planning can connect a new site.
          maxPeakW:
            facility.fuel === "Hydro"
              ? maxPowerW
              : Math.min(facility.maxPeakW, maxPowerW),
        };
  });
}

/** A quote-only projection uses the same ownership and named-site validators as the command.
 * No receipt or cash change is dispatched until the player confirms the final review. */
export function projectSiteQuote(
  game: GameType,
  project: ProjectSelection,
  tileId: TerritoryTileId,
  connections = tilePurchaseQuotes(game),
) {
  const tile = getTerritoryTile(tileId, game);
  if (!tile) return { reason: "Choose a discovered site." };
  if (
    !tileFitsFacility(tile, project) ||
    !territoryTileInventory(game, tileId).remaining
  )
    return {
      reason: "This technology or project size needs a vacant compatible site.",
    };
  const owned = ownsTerritoryTile(game, tile);
  const connection = owned ? undefined : connections.get(tileId);
  if (connection?.utilityName)
    return {
      reason: "Acquire this utility before planning a project on its site.",
    };
  if (!owned && !connection)
    return {
      reason: "Connect an adjacent site first, or choose a highlighted site.",
    };
  const projected =
    owned || !game.territoryNetwork
      ? game
      : {
          ...game,
          territoryNetwork: {
            ...game.territoryNetwork,
            tilePurchases: [
              ...(game.territoryNetwork.tilePurchases ?? []),
              {
                tileId,
                minute: game.date.minute,
                price: connection!.price,
              },
            ],
          },
        };
  const facility = getBuildFacilityQuote(
    projected,
    project,
    tile.territoryId,
    tileId,
  );
  if (!facility)
    return { reason: "This technology or size is unavailable at this site." };
  const availability = territoryBuildAvailability(
    projected,
    facility,
    tile.territoryId,
    tileId,
  );
  if (!availability.buildable)
    return { reason: availability.reason ?? "This site is unavailable." };
  return {
    facility,
    tile,
    owned,
    connection,
    connectionCost: connection?.price ?? 0,
  };
}
export type ProjectSiteQuote = ReturnType<typeof projectSiteQuote>;
export type ReadyProjectSite = Extract<
  ProjectSiteQuote,
  { facility: FacilityShoppingType }
>;

/** Total capital price, before choosing cash or loan terms in the final review. */
export function projectSiteCapitalCost(quote: ReadyProjectSite): number {
  return quote.connectionCost + quote.facility.buildCost;
}

export function projectReview(
  game: GameType,
  quote: ReadyProjectSite,
  financed: boolean,
  availableCash = currentTick(game)?.cash ?? 0,
) {
  const terms = purchaseTerms(
    quote.facility.buildCost,
    financed,
    game.interestRate,
    0,
    facilityLoanMonths(quote.facility.lifespanYears),
  );
  const required = quote.connectionCost + terms.amountDue;
  // Estimate with the fractional duration and live tick interval. Month-rollover pre-roll
  // also advances construction, so completion near a boundary can fall in the prior month.
  const online = getDateFromMinute(
    game.date.minute +
      Math.ceil(quote.facility.yearsToBuild / YEARS_PER_TICK) * TICK_MINUTES,
    game.startingYear,
  );
  // A calendar month, price, financing, cash or named-site change needs explicit review again.
  const key = JSON.stringify([
    quote.tile.id,
    quote.connection?.quoteKey,
    quote.facility,
    financed,
    game.interestRate,
    availableCash,
    online.month,
    online.year,
  ]);
  return { terms, required, remaining: availableCash - required, online, key };
}
