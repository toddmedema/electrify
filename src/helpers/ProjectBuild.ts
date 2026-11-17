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
} from "./TerritoryTiles";
import { currentTick } from "./GameSelectors";
import { facilityLoanMonths, purchaseTerms } from "./Financials";
import { getDateFromMinute, MINUTES_PER_MONTH } from "./DateTime";

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
  return storage ? STORAGE(game, size) : GENERATORS(game, size, [], []);
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
  const online = getDateFromMinute(
    game.date.minute +
      Math.round(quote.facility.yearsToBuild * 12) * MINUTES_PER_MONTH,
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
