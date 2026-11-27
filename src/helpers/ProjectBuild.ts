import { GENERATORS, getBuildFacilityQuote, STORAGE } from "../data/Facilities";
import type {
  FacilityShoppingType,
  GeneratorShoppingType,
  StorageShoppingType,
  GameType,
  TerritoryTileId,
} from "../Types";
import { isStorage } from "../Types";
import {
  tilePurchaseQuote,
  tilePurchaseQuotes,
  territoryBuildAvailability,
} from "./Territories";
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
import {
  pendingTileConnections,
  tileConnectionStatus,
} from "./TerritoryConnections";
import { currentTick } from "./GameSelectors";
import { facilityConstructionReview } from "./FacilityConstructionReview";
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
  const options = storage
    ? STORAGE(game, size)
    : GENERATORS(game, size, [], []);
  return withTerritoryCatalogueLimits(game, options);
}

/** Catalogue-only ceilings leave canonical economics and retained-facility expansion quotes intact. */
export function withTerritoryCatalogueLimits(
  game: GameType,
  options: GeneratorShoppingType[],
): GeneratorShoppingType[];
export function withTerritoryCatalogueLimits(
  game: GameType,
  options: StorageShoppingType[],
): StorageShoppingType[];
export function withTerritoryCatalogueLimits(
  game: GameType,
  options: FacilityShoppingType[],
): FacilityShoppingType[];
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

/** Price the proposed facility as if its connection were already available. */
export function withProjectSiteOwnership(
  game: GameType,
  { tileId, price }: { tileId: TerritoryTileId; price: number },
): GameType {
  return {
    ...game,
    territoryNetwork: {
      ...game.territoryNetwork!,
      tilePurchases: [
        ...(game.territoryNetwork?.tilePurchases ?? []),
        { tileId, minute: game.date.minute, price },
      ],
    },
  };
}

/** A quote-only projection uses the same ownership and named-site validators as the command.
 * No receipt or cash change is dispatched until the player confirms the final review. */
export function projectSiteQuote(
  game: GameType,
  project: ProjectSelection,
  tileId: TerritoryTileId,
  connections?: ReturnType<typeof tilePurchaseQuotes>,
) {
  const tile = getTerritoryTile(tileId, game);
  if (!tile) return { reason: "Choose a discovered site." };
  if (
    !tileFitsFacility(tile, project) ||
    !territoryTileInventory(game, tileId).remaining
  )
    return {
      reason: "No sites available",
    };
  const pending = pendingTileConnections(game).get(tileId);
  if (pending) return { reason: tileConnectionStatus(pending, game) };
  const owned = ownsTerritoryTile(game, tile);
  const connection = owned
    ? undefined
    : connections
      ? connections.get(tileId)
      : tilePurchaseQuote(game, tileId);
  if (!owned && !connection)
    return {
      reason: "Connect an adjacent site first, or choose a highlighted site.",
    };
  const projected = connection
    ? withProjectSiteOwnership(game, connection)
    : game;
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
  quote: Pick<ReadyProjectSite, "facility" | "tile" | "connection">,
  financed: boolean,
  availableCash = currentTick(game)?.cash ?? 0,
) {
  const construction = facilityConstructionReview(
    game,
    quote.facility,
    financed,
    quote.tile.id,
  );
  const required =
    (quote.connection?.price ?? 0) + construction.terms.amountDue;
  const connection = quote.connection;
  const connects = connection
    ? getDateFromMinute(
        Math.max(
          connection.connectionMinute,
          game.date.minute + connection.buildMonths * MINUTES_PER_MONTH,
        ),
        game.startingYear,
      )
    : undefined;
  const online =
    connects && connects.minute > construction.online.minute
      ? connects
      : construction.online;
  const buildKey = connects
    ? JSON.stringify([construction.key, connects.year, connects.month])
    : construction.key;
  return {
    terms: construction.terms,
    required,
    remaining: availableCash - required,
    availableCash,
    online,
    connects,
    key: JSON.stringify([connection?.quoteKey, buildKey, availableCash]),
    buildKey,
  };
}
