import {
  getTerritoryTile,
  tileFitsFacility,
  isRetainedEnhancedGeothermalSite,
  ownsTerritoryTile,
  territoryVisibilityDistance,
  territoryHexDistance,
  isAdjacentToOwnedTerritoryTile,
  isRetainedLakeOffshoreFacility,
  isGeneralBuildingLand,
} from "./TerritoryTiles";
import { TICK_MINUTES } from "../Constants";
import type { GameType, TerritoryTileId } from "../Types";
import type { TerritoryTileDefinition } from "../data/TerritoryTiles";
import {
  isTerritoryId,
  isLandTerritoryId,
  LAND_TERRITORIES,
} from "../data/Territories";
import { UTILITY_AREAS } from "../data/UtilityExpansion";
import { isUtilityExpansionGame } from "./ExpansionContext";
import {
  facilityTerritoryId,
  ownedTerritories,
  landPrice,
  tilePrice,
} from "./Territories";

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const nonnegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const close = (a: number, b: number) =>
  Math.abs(a - b) <= Math.max(1, Math.abs(b)) * 1e-8;
const tickFields = [
  "demandW",
  "supplyW",
  "generationW",
  "storageChargeW",
  "storageDischargeW",
  "importedW",
  "exportedW",
  "unservedW",
  "curtailedW",
] as const;

/** Only the whole-world parser supplies peer claims already admitted in chronological order. */
export type TerritoryPurchaseContext = ReadonlyMap<
  TerritoryTileId,
  readonly TerritoryTileDefinition[]
>;

/** Rebuild a receipt's own anchors without granting later purchases, PPAs or acquisitions. */
export function territoryGameAtPurchase(
  game: GameType,
  minute: number,
  tilePurchases: NonNullable<GameType["territoryNetwork"]>["tilePurchases"],
): GameType {
  return {
    ...game,
    date: { ...game.date, minute },
    multiplayer: undefined,
    territoryNetwork: game.territoryNetwork
      ? {
          ...game.territoryNetwork,
          landPurchases: game.territoryNetwork.landPurchases.filter(
            (entry) => entry.minute <= minute,
          ),
          tilePurchases,
        }
      : undefined,
    utilityExpansion: game.utilityExpansion
      ? {
          ...game.utilityExpansion,
          acquisitions: game.utilityExpansion.acquisitions.filter(
            (entry) => entry.minute <= minute,
          ),
        }
      : undefined,
    transmission: game.transmission
      ? {
          ...game.transmission,
          acceptedAgreements: game.transmission.acceptedAgreements?.filter(
            (entry) => entry.acceptedMinute <= minute,
          ),
        }
      : undefined,
  };
}
/** Derived balances may be absent in historical frames; they are never migration inputs. */
export function validTerritoryNetwork(
  game: GameType,
  peers?: TerritoryPurchaseContext,
): boolean {
  if (!isUtilityExpansionGame(game))
    return (
      game.territoryNetwork === undefined &&
      game.facilities.every(
        (facility) =>
          facility.territoryId === undefined ||
          facility.territoryId === "champlain",
      ) &&
      game.facilities.every((facility) => facility.tileId === undefined) &&
      game.timeline.every((tick) => tick.territories === undefined)
    );
  if (
    !record(game.territoryNetwork) ||
    game.territoryNetwork.version !== 3 ||
    Object.keys(game.territoryNetwork).some(
      (key) =>
        ![
          "version",
          "landPurchases",
          "legacyConnections",
          "tilePurchases",
          "legacyTiles",
          "legacyLakeOffshore",
        ].includes(key),
    )
  )
    return false;
  const state = game.territoryNetwork;
  if (
    !Array.isArray(state.legacyTiles) ||
    !Array.isArray(state.tilePurchases) ||
    !Array.isArray(state.landPurchases) ||
    state.landPurchases.length > LAND_TERRITORIES.length ||
    !Array.isArray(state.legacyConnections) ||
    state.legacyConnections.length > 16
  )
    return false;
  if (
    new Set(state.landPurchases.map((receipt) => receipt?.territoryId)).size !==
    state.landPurchases.length
  )
    return false;
  for (const receipt of state.landPurchases) {
    if (
      !record(receipt) ||
      !LAND_TERRITORIES.some(({ id }) => id === receipt.territoryId) ||
      !Number.isSafeInteger(receipt.minute) ||
      receipt.minute < 0 ||
      receipt.minute > game.date.minute ||
      receipt.minute % TICK_MINUTES !== 0 ||
      !nonnegative(receipt.price)
    )
      return false;
    if (receipt.legacy === true) {
      const line = state.legacyConnections.find(
        (line) => line.corridorId === "vt-champlain-uplands",
      );
      if (
        receipt.territoryId !== "green-uplands" ||
        !line ||
        line.minuteCreated !== receipt.minute ||
        line.buildCost !== receipt.price ||
        Object.keys(receipt).length !== 4
      )
        return false;
    } else if (
      receipt.legacy !== undefined ||
      Object.keys(receipt).length !== 3 ||
      !close(
        receipt.price,
        landPrice(game, receipt.minute, receipt.territoryId),
      )
    )
      return false;
  }
  const legacyIds = new Set<string>();
  for (const [index, tile] of (state.legacyTiles ?? []).entries()) {
    const suffix =
      typeof tile?.id === "string" ? tile.id.split(":legacy-")[1] : undefined;
    const identity = Number(suffix);
    if (
      !record(tile) ||
      ![
        "id",
        "territoryId",
        "q",
        "r",
        "terrain",
        "siteKind",
        "maxPeakW",
        "hydroSiteId",
      ].every((key) => key in tile || key === "hydroSiteId") ||
      Object.keys(tile).some(
        (key) =>
          ![
            "id",
            "territoryId",
            "q",
            "r",
            "terrain",
            "siteKind",
            "maxPeakW",
            "hydroSiteId",
          ].includes(key),
      ) ||
      ![
        "champlain",
        "valley-electric",
        "ridge-electric",
        "green-uplands",
      ].includes(tile.territoryId) ||
      !Number.isSafeInteger(identity) ||
      identity < 0 ||
      suffix !== String(identity) ||
      tile.id !== `${tile.territoryId}:legacy-${identity}` ||
      legacyIds.has(tile.id) ||
      tile.q !== 6 + (index % 4) ||
      tile.r !== -4 + Math.floor(index / 4) ||
      !["industrial", "wind", "open-land", "hydro", "geothermal"].includes(
        tile.siteKind,
      ) ||
      !["plains", "lake", "mountain"].includes(tile.terrain) ||
      !Number.isFinite(tile.maxPeakW) ||
      tile.maxPeakW <= 0 ||
      (tile.hydroSiteId !== undefined &&
        (typeof tile.hydroSiteId !== "string" || !tile.hydroSiteId))
    )
      return false;
    legacyIds.add(tile.id);
  }
  const purchased = new Set<string>();
  for (const receipt of state.tilePurchases ?? []) {
    const tile = getTerritoryTile(receipt?.tileId, game);
    if (
      !record(receipt) ||
      (receipt.legacy === true
        ? Object.keys(receipt).length !== 4
        : receipt.legacy !== undefined || Object.keys(receipt).length !== 3) ||
      !tile ||
      !isLandTerritoryId(tile.territoryId) ||
      purchased.has(tile.id) ||
      state.landPurchases.some(
        ({ territoryId }) => territoryId === tile.territoryId,
      ) ||
      !Number.isSafeInteger(receipt.minute) ||
      receipt.minute < 0 ||
      receipt.minute > game.date.minute ||
      receipt.minute % TICK_MINUTES !== 0 ||
      !nonnegative(receipt.price) ||
      !close(receipt.price, tilePrice(game, receipt.minute, tile.id))
    )
      return false;
    const earlier = (state.tilePurchases ?? []).slice(0, purchased.size);
    const historical = territoryGameAtPurchase(game, receipt.minute, earlier);
    if (
      earlier.some((entry) => entry.minute > receipt.minute) ||
      (receipt.legacy === true
        ? territoryVisibilityDistance(historical, tile) === undefined &&
          !peers
            ?.get(tile.id)
            ?.some((anchor) => territoryHexDistance(anchor, tile) <= 3)
        : !isAdjacentToOwnedTerritoryTile(historical, tile))
    )
      return false;
    purchased.add(tile.id);
  }
  if (
    state.legacyConnections.some(
      (line) => line.corridorId === "vt-champlain-uplands",
    ) !== state.landPurchases.some((receipt) => receipt.legacy === true)
  )
    return false;
  const owned = ownedTerritories(game);
  const placements = new Set<string>();
  if (
    state.legacyLakeOffshore !== undefined &&
    (!Array.isArray(state.legacyLakeOffshore) ||
      new Set(state.legacyLakeOffshore.map((entry) => entry?.facilityId))
        .size !== state.legacyLakeOffshore.length ||
      state.legacyLakeOffshore.some((entry) => {
        const tile = getTerritoryTile(entry?.tileId, game);
        const plant = game.facilities.find(
          ({ id }) => id === entry?.facilityId,
        );
        return (
          !record(entry) ||
          Object.keys(entry).length !== 2 ||
          !Number.isSafeInteger(entry.facilityId) ||
          entry.facilityId < 0 ||
          !tile ||
          tile.terrain !== "lake" ||
          tile.siteKind !== "wind" ||
          !(tile.id === "champlain:site-14" || tile.id.includes(":legacy-")) ||
          (!!plant &&
            (plant.tileId !== entry.tileId || plant.fuel !== "Offshore Wind"))
        );
      }))
  )
    return false;
  if (
    game.facilities.some((facility) => {
      if (
        typeof facility.tileId !== "string" ||
        placements.has(facility.tileId)
      )
        return true;
      const tile = getTerritoryTile(facility.tileId, game);
      if (
        !tile ||
        tile.territoryId !== facilityTerritoryId(facility) ||
        (!tileFitsFacility(
          tile,
          facility,
          isGeneralBuildingLand(tile) ||
            isRetainedEnhancedGeothermalSite(tile, facility) ||
            !isLandTerritoryId(tile.territoryId) ||
            !!state.landPurchases.some(
              ({ territoryId }) => territoryId === tile.territoryId,
            ),
        ) &&
          !isRetainedLakeOffshoreFacility(game, facility))
      )
        return true;
      placements.add(tile.id);
      return false;
    })
  )
    return false;
  if (
    game.facilities.some((facility) => {
      if (
        facility.territoryId !== undefined &&
        !isTerritoryId(facility.territoryId)
      )
        return true;
      const id = facilityTerritoryId(facility);
      if (isLandTerritoryId(id)) {
        const tile = getTerritoryTile(facility.tileId, game);
        const retained = state.landPurchases.find(
          (receipt) => receipt.territoryId === id,
        );
        const purchase =
          retained ??
          state.tilePurchases?.find(
            (receipt) => receipt.tileId === facility.tileId,
          );
        if (
          !tile ||
          !ownsTerritoryTile(game, tile) ||
          !purchase ||
          facility.minuteCreated < purchase.minute
        )
          return true;
      }
      const provenance = Object.values(UTILITY_AREAS).find((area) =>
        area.facilities.some(
          ({ assetId }) => assetId === facility.startingAssetId,
        ),
      );
      return !owned.includes(id) || (!!provenance && provenance.id !== id);
    })
  )
    return false;
  return game.timeline.every((tick) => {
    if (tick.territories === undefined) return true;
    if (!record(tick.territories) || Object.keys(tick.territories).length === 0)
      return false;
    let demandW = 0;
    let supplyW = 0;
    let importedW = 0;
    let exportedW = 0;
    for (const [id, balance] of Object.entries(tick.territories)) {
      if (
        !isTerritoryId(id) ||
        !record(balance) ||
        Object.keys(balance).length !== tickFields.length ||
        !tickFields.every((field) => nonnegative(balance[field])) ||
        balance.supplyW > balance.demandW + 0.01 ||
        !close(
          balance.unservedW,
          Math.max(0, balance.demandW - balance.supplyW),
        ) ||
        (id === "green-uplands" && balance.demandW !== 0)
      )
        return false;
      demandW += balance.demandW;
      supplyW += balance.supplyW;
      importedW += balance.importedW;
      exportedW += balance.exportedW;
    }
    return (
      close(demandW, tick.demandW) &&
      close(supplyW, tick.supplyW) &&
      close(importedW, tick.importedW ?? 0) &&
      close(exportedW, tick.exportedW ?? 0)
    );
  });
}
