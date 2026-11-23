import {
  type AcquireLandAction,
  type AcquireTileAction,
  type TerritoryTileId,
  type TerrainType,
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
import { isValleyBoardTile } from "../data/TerritoryTiles";
import {
  municipalUtility,
  municipalUtilityAt,
} from "../data/MunicipalUtilities";
import { UTILITY_AREAS } from "../data/UtilityExpansion";
import { getInflationIndex, hasEconomy } from "../data/Economy";
import cloneDeep from "lodash.clonedeep";
import { getDateFromMinute, MINUTES_PER_MONTH } from "./DateTime";
import {
  pendingTileConnections,
  tileConnectionDuration,
  tileConnectionLabel,
} from "./TerritoryConnections";
import { currentTick } from "./GameSelectors";
import { customerMarketSizeAt } from "./Customers";
import { cityCustomerCount, cityProfile } from "./CityProfiles";
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
  territoryTileInventory,
  territoryFacilityInventory,
  getTerritoryTile,
  tileFitsFacility,
  facilityOnTile,
  ownsTerritoryTile,
  getTerritoryTiles,
  scenarioMapTiles,
  createTerritoryTileOwnership,
  createTerritoryTileAdjacency,
  createTileConnectionSchedule,
  ownedTerritoryTiles,
  territoryHexDistance,
  isGeneralBuildingLand,
  territoryTilePowerLimit,
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
  const automatic =
    tileId === undefined
      ? territoryFacilityInventory(game, facility, id)
      : undefined;
  const { remaining, total, maxPeakW } =
    automatic ?? territoryTileInventory(game, tileId, facility);
  const inventory = { remaining, total, maxPeakW };
  const requested =
    tileId === undefined ? undefined : getTerritoryTile(tileId, game);
  const reject = (reason: string) => ({
    buildable: false,
    reason,
    ...inventory,
  });
  if (!territory) return reject("Choose a valid territory.");
  if (
    tileId === undefined
      ? !ownedTerritories(game).includes(id)
      : requested && !ownsTerritoryTile(game, requested)
  )
    return reject("Acquire this tile before building.");
  if (tileId !== undefined) {
    const connection = pendingTileConnections(game).get(tileId);
    if (connection)
      return reject(tileConnectionLabel(connection, game.date.minute));
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
    if (!inventory.remaining)
      return reject("This named site has already been used.");
  }
  const free = automatic?.available ?? [];
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
    maxPeakW: territoryTilePowerLimit(selected, facility),
    tileId: selected.id,
  };
}

function territoryDemandAreas(game: GameType, minute: number) {
  return [
    ...Object.values(UTILITY_AREAS)
      .filter(
        ({ id }) =>
          id === "champlain" ||
          (hasTerritoryNetwork(game) &&
            game.utilityExpansion?.acquisitions.some(
              (receipt) => receipt.targetId === id && receipt.minute <= minute,
            )),
      )
      .map(({ id }) => cityProfile(game.seed, id)!),
    ...landCustomerProfiles(game, Math.min(game.date.minute, minute)),
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
        area && total > 0
          ? (Math.max(0, load) *
              area.customers *
              area.demandScale *
              (key ? area.energyShares[key] : 1)) /
            total
          : 0,
      ];
    }),
  ) as DemandByTypeType;
}
/** Apportion actual sector demand by inherited customer/load weights; never add another load. */
export function territoryDemandShares(
  game: GameType,
  tick: Pick<TickPresentFutureType, "demandW" | "demandByType" | "minute">,
): Record<TerritoryId, number> {
  const result = Object.fromEntries(
    [
      ...TERRITORIES,
      ...purchasedLandTerritories(
        game,
        Math.min(game.date.minute, tick.minute),
      ),
    ].map(({ id }) => [id, 0]),
  ) as Record<TerritoryId, number>;
  const areas = territoryDemandAreas(game, tick.minute);
  const totalWeight = areas.reduce(
    (sum, area) => sum + area.customers * area.demandScale,
    0,
  );
  for (const [sector, load] of Object.entries(tick.demandByType)) {
    const key =
      sector === "Residential" ||
      sector === "Commercial" ||
      sector === "Industrial"
        ? sector
        : undefined;
    const sectorWeight = areas.reduce(
      (sum, area) =>
        sum +
        area.customers * area.demandScale * (key ? area.energyShares[key] : 1),
      0,
    );
    for (const area of areas)
      result[area.id] +=
        (Math.max(0, load) *
          area.customers *
          area.demandScale *
          (key ? area.energyShares[key] : 1)) /
        sectorWeight;
  }
  const total = Object.values(result).reduce((sum, load) => sum + load, 0);
  for (const area of areas)
    result[area.id] =
      total > 0
        ? (result[area.id] / total) * tick.demandW
        : ((area.customers * area.demandScale) / totalWeight) * tick.demandW;
  // Keep the company total exact despite division roundoff.
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
function landInflation(
  game: Pick<GameType, "seed" | "startingYear">,
  minute: number,
): number {
  return hasEconomy()
    ? getInflationIndex(
        getDateFromMinute(minute, game.startingYear),
        2005,
        game.seed,
      )
    : 1;
}

export function landPrice(
  game: Pick<GameType, "seed" | "startingYear">,
  minute: number,
  id: LandTerritoryId = "green-uplands",
): number {
  return (
    (getTerritoryDefinition(id)?.price2005 ?? LAND_PRICE_2005) *
    landInflation(game, minute)
  );
}
/** Parcel pricing for existing receipts, municipal acquisitions and named resource sites. */
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
type TerritoryTile = NonNullable<ReturnType<typeof getTerritoryTile>>;

// DOE National Transmission Planning Study, chapter 3, table D-3.
const lineTerrainCost: Partial<Record<TerrainType, number>> = {
  plains: 1,
  forest: 2.25,
  hills: 1.4,
  mountain: 1.75,
};
const CONNECTION_TERMINAL_COST_2005 = 2.4e6;
const CONNECTION_LINE_COST_PER_HEX_2005 = 0.6e6;

export function isOrdinaryTileConnection(tile: TerritoryTile): boolean {
  return isGeneralBuildingLand(tile) && !municipalUtilityAt(tile);
}

export function ordinaryTileConnectionPrice(
  game: Pick<GameType, "seed" | "startingYear">,
  minute: number,
  terrain: TerrainType,
  distance: number,
): number {
  return (
    (CONNECTION_TERMINAL_COST_2005 +
      CONNECTION_LINE_COST_PER_HEX_2005 *
        distance *
        (lineTerrainCost[terrain] ?? 1)) *
    landInflation(game, minute)
  );
}

function availableLand(
  game: GameType,
  owns: ReturnType<typeof createTerritoryTileOwnership>,
  tile: TerritoryTile,
): tile is TerritoryTile & { territoryId: LandTerritoryId } {
  return (
    isLandTerritoryId(tile.territoryId) &&
    isValleyBoardTile(tile.id) &&
    !owns(tile) &&
    !game.multiplayer?.tileOwners?.[tile.id] &&
    !game.multiplayer?.landOwners?.[tile.territoryId]
  );
}

function tilePurchaseContext(
  game: GameType,
  owns = createTerritoryTileOwnership(game),
) {
  const enabled = hasTerritoryNetwork(game);
  const owned = ownedTerritoryTiles(game, owns);
  const adjacent = createTerritoryTileAdjacency(owned);
  const schedule = createTileConnectionSchedule(game, owned);
  const pending = pendingTileConnections(game);
  const cities = owned.filter(({ id, city }) => city && !pending.has(id));
  const eligible = (
    tile: TerritoryTile,
  ): tile is TerritoryTile & { territoryId: LandTerritoryId } =>
    enabled &&
    availableLand(game, owns, tile) &&
    !municipalUtilityAt(tile)?.plant &&
    adjacent(tile);
  const quote = (tile: TerritoryTile) => {
    if (!eligible(tile)) return undefined;
    const territory = getTerritoryDefinition(tile.territoryId)!;
    const baseCustomers = cityCustomerCount(tile.territoryId);
    const minute = game.date.minute;
    const connectionDistance = isOrdinaryTileConnection(tile)
      ? Math.min(...cities.map((city) => territoryHexDistance(city, tile)))
      : undefined;
    const price =
      connectionDistance === undefined
        ? tilePrice(game, minute, tile.id)
        : ordinaryTileConnectionPrice(
            game,
            minute,
            tile.terrain,
            connectionDistance,
          );
    const purchases = [
      {
        tileId: tile.id,
        price,
        connectionMinute: schedule(tile),
        ...(connectionDistance === undefined ? {} : { connectionDistance }),
      },
    ];
    return {
      tileId: tile.id,
      territoryId: tile.territoryId,
      price,
      benefit: territory.benefit!,
      customers: tile.city
        ? customerMarketSizeAt(baseCustomers, purchases[0].connectionMinute)
        : 0,
      connectionMinute: purchases[0].connectionMinute,
      buildMonths: tileConnectionDuration(game.difficulty) / MINUTES_PER_MONTH,
      purchases,
      quoteKey: JSON.stringify([
        tile.id,
        price,
        territory.benefit,
        baseCustomers,
        tileConnectionDuration(game.difficulty),
      ]),
    };
  };
  return { eligible, quote };
}

/** The seller's available sites form one offer, regardless of which border the player reached. */
export function municipalTerritoryOffer(game: GameType, id: unknown) {
  const utility = municipalUtility(id);
  if (!utility || !hasTerritoryNetwork(game)) return undefined;
  const owns = createTerritoryTileOwnership(game);
  const candidates = [
    utility.city,
    utility.plant && getTerritoryTile(utility.plant.tileId, game),
  ];
  const sites = candidates.filter(
    (tile): tile is TerritoryTile => !!tile && availableLand(game, owns, tile),
  );
  if (!sites.length) return undefined;
  const pending = pendingTileConnections(game);
  const adjacent = createTerritoryTileAdjacency(
    ownedTerritoryTiles(game, owns).filter(({ id }) => !pending.has(id)),
  );
  // A legacy city or plant can already belong to a company independently.
  const purchases = [...sites]
    .sort((a, b) => Number(adjacent(b)) - Number(adjacent(a)))
    .map(({ id: tileId }) => ({
      tileId,
      price: tilePrice(game, game.date.minute, tileId),
    }));
  return {
    utility,
    purchases,
    reachable: sites.some(adjacent),
    customers: sites.some((tile) => tile.id === utility.city.id)
      ? customerMarketSizeAt(cityCustomerCount(utility.id), game.date.minute)
      : 0,
    plant: sites.some((tile) => tile.id === utility.plant?.tileId)
      ? utility.plant
      : undefined,
    price: purchases.reduce((total, part) => total + part.price, 0),
  };
}

export function createTilePurchaseEligibility(
  game: GameType,
  owns = createTerritoryTileOwnership(game),
) {
  return tilePurchaseContext(game, owns).eligible;
}

export function tilePurchaseQuote(game: GameType, tileId: TerritoryTileId) {
  const tile = getTerritoryTile(tileId, game);
  return tile && tilePurchaseContext(game).quote(tile);
}
/** Quote neighboring cells on the fixed scenario board with one shared ownership lookup. */
export function tilePurchaseQuotes(
  game: GameType,
  visible: readonly { tile: TerritoryTile }[] = scenarioMapTiles(game),
) {
  const { quote } = tilePurchaseContext(game);
  return new Map(
    visible.flatMap(({ tile }) => {
      const offer = quote(tile);
      return offer ? [[tile.id, offer] as const] : [];
    }),
  );
}
/** Compatibility entry point uses the first available site as the purchase entrance. */
export function landPurchaseQuote(
  game: GameType,
  id: LandTerritoryId = "green-uplands",
) {
  const { quote } = tilePurchaseContext(game);
  for (const tile of getTerritoryTiles(game)) {
    if (tile.territoryId !== id) continue;
    const offer = quote(tile);
    if (offer) return offer;
  }
  return undefined;
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
  return transferTerritorySites(game, { ...quote, customers: 0 });
}

export function transferTerritorySites(
  game: GameType,
  quote: Pick<
    NonNullable<ReturnType<typeof tilePurchaseQuote>>,
    "price" | "customers"
  > & {
    purchases: Omit<
      NonNullable<
        NonNullable<GameType["territoryNetwork"]>["tilePurchases"]
      >[number],
      "minute"
    >[];
  },
  cashDue = quote.price,
): boolean {
  const now = currentTick(game);
  if (!now || now.cash < cashDue || !game.territoryNetwork) return false;
  const priorProgramCustomers =
    quote.customers > 0 ? programCustomers(game) : undefined;
  now.cash -= cashDue;
  (game.territoryNetwork.tilePurchases ??= []).push(
    ...quote.purchases.map((site) => ({ ...site, minute: game.date.minute })),
  );
  if (priorProgramCustomers !== undefined) {
    now.customers += quote.customers;
    updateTileCustomerMarket(game, priorProgramCustomers);
  }
  // Land is a non-depreciating asset. A financed purchase covers the rest of the price with debt.
  return true;
}

/** Tick settlement credits newly energized towns once, including after loading a save. */
export function energizeTileCustomers(game: GameType): number {
  let customers = 0;
  for (const receipt of game.territoryNetwork?.tilePurchases ?? []) {
    if (receipt.connectionMinute !== game.date.minute) continue;
    const tile = getTerritoryTile(receipt.tileId, game);
    if (tile?.city)
      customers += customerMarketSizeAt(
        cityCustomerCount(tile.territoryId),
        game.date.minute,
      );
  }
  if (!customers) return 0;
  const priorProgramCustomers = programCustomers({
    ...game,
    date: { ...game.date, minute: game.date.minute - 1 },
  });
  if (game.policies) game.policies = cloneDeep(game.policies);
  updateTileCustomerMarket(game, priorProgramCustomers);
  return customers;
}

function updateTileCustomerMarket(
  game: GameType,
  priorProgramCustomers: number,
) {
  game.customerMarketSize =
    UTILITY_AREAS.champlain.addressablePool +
    (game.utilityExpansion?.acquisitions.reduce(
      (sum, receipt) => sum + UTILITY_AREAS[receipt.targetId].addressablePool,
      0,
    ) ?? 0) +
    landCustomerMarket(game);
  const ratio = priorProgramCustomers / programCustomers(game);
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
