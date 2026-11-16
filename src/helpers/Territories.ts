import {
  type AcquireLandAction,
  type AcquireTileAction,
  type TerritoryTileId,
  type DemandByTypeType,
  type LandTerritoryId,
  type FacilityShoppingType,
  type GameType,
  type TerritoryId,
  type TickPresentFutureType,
} from "../Types";
import {
  GREEN_UPLANDS_CORRIDOR_ID,
  TERRITORIES,
  isLandTerritoryId,
  territoryHydroSiteId,
  getTerritoryDefinition,
  purchasedLandTerritories,
} from "../data/Territories";
import { UTILITY_AREAS } from "../data/UtilityExpansion";
import { getInflationIndex, hasEconomy } from "../data/Economy";
import { getDateFromMinute } from "./DateTime";
import { currentTick } from "./GameSelectors";
import { customerMarketSizeAt } from "./Customers";
import { landCustomerProfiles, landCustomerMarket } from "./TerritoryCustomers";
import {
  programCustomers,
  buildoutComplete,
  isOperatingPolicy,
} from "./Policies";

import {
  hasTerritoryNetwork,
  ownedTerritories,
  facilityTerritoryId,
  territorySiteKind,
  territorySiteInventory,
  territoryTileInventory,
  availableTerritoryTiles,
  getTerritoryTile,
  tileFitsFacility,
  facilityOnTile,
  ownsTerritoryTile,
  getTerritoryTiles,
  territoryVisibilityDistance,
} from "./TerritoryTiles";
export {
  hasTerritoryNetwork,
  ownedTerritories,
  facilityTerritoryId,
  territorySiteKind,
  territorySiteInventory,
} from "./TerritoryTiles";

export function territoryBuildAvailability(
  game: GameType,
  facility: FacilityShoppingType,
  id: TerritoryId,
  tileId?: import("../Types").TerritoryTileId,
): {
  buildable: boolean;
  reason?: string;
  remaining: number;
  total: number;
  maxPeakW: number;
  tileId?: import("../Types").TerritoryTileId;
} {
  if (!hasTerritoryNetwork(game))
    return {
      buildable: true,
      remaining: Infinity,
      total: Infinity,
      maxPeakW: Infinity,
    };
  const territory = getTerritoryDefinition(id);
  const specific = territorySiteKind(facility);
  const kind =
    specific !== "hydro" &&
    specific !== "geothermal" &&
    (territory?.sites.general.count ?? 0) > 0
      ? "general"
      : specific;
  const inventory =
    tileId === undefined
      ? territorySiteInventory(game, id, kind)
      : territoryTileInventory(game, tileId);
  const free = availableTerritoryTiles(game, facility, id);
  const requested =
    tileId === undefined ? undefined : getTerritoryTile(tileId, game);
  const reject = (reason: string) => ({
    buildable: false,
    reason,
    ...inventory,
  });
  if (!territory) return reject("Choose a valid territory.");
  if (
    !ownedTerritories(game).includes(id) ||
    (requested && !ownsTerritoryTile(game, requested))
  )
    return reject("Acquire this tile before building.");
  if (tileId !== undefined) {
    if (!requested || requested.territoryId !== id)
      return reject("Choose a valid tile in this territory.");
    if (requested.city)
      return reject("Cities add demand and have no building slot.");
    if (facilityOnTile(game, requested.id))
      return reject(
        "This tile already has a facility or construction project.",
      );
    if (!tileFitsFacility(requested, facility))
      return reject("This technology or project size does not fit this tile.");
    if (!free.some((tile) => tile.id === requested.id))
      return reject("This named site has already been used.");
  }
  const selected = requested ?? free[0];
  if (!selected) {
    if (!inventory.remaining)
      return reject("No sites of this type remain in this territory.");
    if (
      !Number.isFinite(facility.peakW) ||
      facility.peakW <= 0 ||
      facility.peakW > inventory.maxPeakW
    )
      return reject(
        "This project exceeds the territory’s per-site power limit.",
      );
    return reject("No free tile supports this technology.");
  }
  return {
    buildable: true,
    remaining: tileId === undefined ? free.length : inventory.remaining,
    total: inventory.total,
    maxPeakW: selected.maxPeakW ?? 0,
    tileId: selected.id,
  };
}

function territoryDemandAreas(game: GameType, minute: number) {
  return [
    ...Object.values(UTILITY_AREAS).filter(
      ({ id }) =>
        id === "champlain" ||
        (hasTerritoryNetwork(game) &&
          game.utilityExpansion?.acquisitions.some(
            (receipt) => receipt.targetId === id && receipt.minute <= minute,
          )),
    ),
    ...landCustomerProfiles(game, minute),
  ];
}
/** Actual demand allocation shared by the map total and the city end-use chart. */
export function territoryDemandByType(
  game: GameType,
  tick: Pick<TickPresentFutureType, "demandW" | "demandByType" | "minute">,
  id: TerritoryId,
): DemandByTypeType {
  const areas = territoryDemandAreas(game, tick.minute);
  const area = areas.find((entry) => entry.id === id);
  return Object.fromEntries(
    Object.entries(tick.demandByType).map(([sector, load]) => {
      const key =
        sector === "Residential" ||
        sector === "Commercial" ||
        sector === "Industrial"
          ? sector
          : undefined;
      const weight = (entry: (typeof areas)[number]) =>
        entry.customers *
        entry.demandScale *
        (key ? entry.energyShares[key] : 1);
      const total = areas.reduce((sum, entry) => sum + weight(entry), 0);
      return [
        sector,
        area && total > 0 ? (Math.max(0, load) * weight(area)) / total : 0,
      ];
    }),
  ) as DemandByTypeType;
}
/** Apportion actual sector demand by inherited customer/load weights; never add another load. */
export function territoryDemandShares(
  game: GameType,
  tick: Pick<TickPresentFutureType, "demandW" | "demandByType" | "minute">,
): Record<TerritoryId, number> {
  const areas = territoryDemandAreas(game, tick.minute);
  const result = Object.fromEntries(
    [...TERRITORIES, ...purchasedLandTerritories(game)].map(({ id }) => [
      id,
      0,
    ]),
  ) as Record<TerritoryId, number>;
  for (const area of areas)
    result[area.id] = Object.values(
      territoryDemandByType(game, tick, area.id),
    ).reduce((sum, value) => sum + value, 0);
  const total = Object.values(result).reduce((sum, load) => sum + load, 0);
  const totalWeight = areas.reduce(
    (sum, area) => sum + area.customers * area.demandScale,
    0,
  );
  for (const area of areas)
    result[area.id] =
      total > 0
        ? (result[area.id] / total) * tick.demandW
        : ((area.customers * area.demandScale) / totalWeight) * tick.demandW;
  result.champlain +=
    tick.demandW - Object.values(result).reduce((sum, load) => sum + load, 0);
  return result;
}

export function territoryForCorridor(corridorId: string): TerritoryId {
  if (
    corridorId === "vt-valley-regional" ||
    corridorId === "vt-champlain-valley"
  )
    return "valley-electric";
  if (corridorId === "vt-ridge-regional" || corridorId === "vt-champlain-ridge")
    return "ridge-electric";
  if (corridorId === GREEN_UPLANDS_CORRIDOR_ID) return "green-uplands";
  return "champlain";
}

/** Legacy investments retain their exact financed balances, without operating as wires. */
export function legacyTerritoryConnections(
  game: Pick<GameType, "territoryNetwork">,
) {
  return game.territoryNetwork?.legacyConnections ?? [];
}
export const LAND_PRICE_2005 = 18e6;
export function landPrice(
  game: Pick<GameType, "seed" | "startingYear">,
  minute: number,
  id: LandTerritoryId = "green-uplands",
): number {
  return (
    (getTerritoryDefinition(id)?.price2005 ?? LAND_PRICE_2005) *
    (hasEconomy()
      ? getInflationIndex(
          getDateFromMinute(minute, game.startingYear),
          2005,
          game.seed,
        )
      : 1)
  );
}
/** Historical whole-region pricing remains the validator for retained receipts only. */
export function tilePrice(
  game: Pick<GameType, "seed" | "startingYear">,
  minute: number,
  tileId: TerritoryTileId,
): number {
  const tile = getTerritoryTile(tileId);
  if (!tile || !isLandTerritoryId(tile.territoryId)) return NaN;
  const territory = getTerritoryDefinition(tile.territoryId)!;
  const count =
    territory.benefit === "general"
      ? Math.max(1, territory.sites.general.count)
      : 1;
  return landPrice(game, minute, tile.territoryId) / count;
}
export function tilePurchaseQuote(game: GameType, tileId: TerritoryTileId) {
  const tile = getTerritoryTile(tileId, game);
  if (
    !hasTerritoryNetwork(game) ||
    !tile ||
    !isLandTerritoryId(tile.territoryId) ||
    ownsTerritoryTile(game, tile) ||
    game.multiplayer?.tileOwners?.[tile.id] ||
    game.multiplayer?.landOwners?.[tile.territoryId] ||
    territoryVisibilityDistance(game, tile) === undefined
  )
    return undefined;
  const territory = getTerritoryDefinition(tile.territoryId)!;
  const price = tilePrice(game, game.date.minute, tile.id);
  return {
    tileId: tile.id,
    territoryId: tile.territoryId,
    price,
    benefit: territory.benefit!,
    customers: tile.city
      ? customerMarketSizeAt(territory.customers ?? 0, game.date.minute)
      : 0,
    quoteKey: JSON.stringify([tile.id, game.date.minute, price]),
  };
}
/** Compatibility entry point selects ONE still-available visible cell; it never grants a region. */
export function landPurchaseQuote(
  game: GameType,
  id: LandTerritoryId = "green-uplands",
) {
  const tile = getTerritoryTiles(game).find(
    (tile) => tile.territoryId === id && !!tilePurchaseQuote(game, tile.id),
  );
  return tile ? tilePurchaseQuote(game, tile.id) : undefined;
}
export function validTilePurchaseAction(
  game: GameType,
  value: unknown,
): value is AcquireTileAction {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const action = value as Partial<AcquireTileAction>;
  const quote = action.tileId
    ? tilePurchaseQuote(game, action.tileId)
    : undefined;
  return (
    Object.keys(value).length === 2 &&
    !!quote &&
    quote.quoteKey === action.quoteKey
  );
}
export function validLandPurchaseAction(
  game: GameType,
  value: unknown,
): value is AcquireLandAction {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const action = value as Partial<AcquireLandAction>;
  const quote = isLandTerritoryId(action.territoryId)
    ? landPurchaseQuote(game, action.territoryId)
    : undefined;
  return (
    Object.keys(value).length === 2 &&
    !!quote &&
    quote.quoteKey === action.quoteKey
  );
}
export function purchaseLand(game: GameType, value: unknown): boolean {
  if (!validLandPurchaseAction(game, value)) return false;
  const quote = landPurchaseQuote(game, value.territoryId)!;
  return purchaseTile(game, { tileId: quote.tileId, quoteKey: quote.quoteKey });
}
export function purchaseTile(game: GameType, value: unknown): boolean {
  if (!validTilePurchaseAction(game, value)) return false;
  const quote = tilePurchaseQuote(game, value.tileId)!;
  const now = currentTick(game);
  if (!now || now.cash < quote.price || !game.territoryNetwork) return false;
  const oldProgramCustomers = programCustomers(game);
  now.cash -= quote.price;
  now.customers += quote.customers;
  (game.territoryNetwork.tilePurchases ??= []).push({
    tileId: quote.tileId,
    minute: game.date.minute,
    price: quote.price,
  });
  if (quote.customers > 0) {
    game.customerMarketSize =
      UTILITY_AREAS.champlain.addressablePool +
      (game.utilityExpansion?.acquisitions.reduce(
        (sum, receipt) => sum + UTILITY_AREAS[receipt.targetId].addressablePool,
        0,
      ) ?? 0) +
      landCustomerMarket(game);
    const ratio = oldProgramCustomers / programCustomers(game);
    for (const [id, program] of Object.entries(game.policies?.programs ?? {})) {
      if (isOperatingPolicy(id as import("../Types").PolicyId)) continue;
      program.adoption *= ratio;
      if (program.installs)
        program.installs = program.installs.map(([month, share]) => [
          month,
          share * ratio,
        ]);
      if (!buildoutComplete(program.adoption)) delete program.completedMonth;
    }
  }
  // Land is a non-depreciating capital asset; exchanging cash for it preserves net worth.
  return true;
}

/** Owned, unreserved fictional special sites; the normal technology owner still prices plants. */
export function territorySpecialSites(
  game: Pick<
    GameType,
    "territoryNetwork" | "facilities" | "commissionedHydroSiteIds"
  >,
  benefit: "hydro" | "geothermal",
  id?: TerritoryId,
) {
  return purchasedLandTerritories(game).filter(
    (territory) =>
      territory.benefit === benefit &&
      (!id || territory.id === id) &&
      !game.facilities.some(
        (facility) =>
          facilityTerritoryId(facility) === territory.id &&
          territorySiteKind(facility) === benefit,
      ) &&
      (benefit !== "hydro" ||
        !game.commissionedHydroSiteIds.includes(
          territoryHydroSiteId(territory.id),
        )),
  );
}

export { landTransferredCustomers } from "./TerritoryCustomers";
