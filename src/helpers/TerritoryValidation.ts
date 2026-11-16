import { getTerritoryTile, tileFitsFacility } from "./TerritoryTiles";
import { TICK_MINUTES } from "../Constants";
import type { GameType } from "../Types";
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
  territorySiteKind,
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

/** Derived balances may be absent in historical frames; they are never migration inputs. */
export function validTerritoryNetwork(game: GameType): boolean {
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
    Object.keys(game.territoryNetwork).length !== 3
  )
    return false;
  const state = game.territoryNetwork;
  if (
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
      !isLandTerritoryId(receipt.territoryId) ||
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
  if (
    state.legacyConnections.some(
      (line) => line.corridorId === "vt-champlain-uplands",
    ) !== state.landPurchases.some((receipt) => receipt.legacy === true)
  )
    return false;
  const owned = ownedTerritories(game);
  const placements = new Set<string>();
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
        !tileFitsFacility(
          tile,
          facility,
          !tile.territoryId.startsWith("parcel-"),
        )
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
      // These parcels did not exist in earlier saves; every plant must fit its purchased rights.
      if (id.startsWith("parcel-")) {
        const territory = LAND_TERRITORIES.find((entry) => entry.id === id)!;
        const purchase = state.landPurchases.find(
          (receipt) => receipt.territoryId === id,
        );
        const specific = territorySiteKind(facility);
        const kind =
          territory.benefit === "general" &&
          specific !== "hydro" &&
          specific !== "geothermal"
            ? "general"
            : specific;
        if (
          !purchase ||
          facility.minuteCreated < purchase.minute ||
          !kind ||
          territory.sites[kind].count === 0 ||
          facility.peakW > territory.sites[kind].maxPeakW ||
          game.facilities.filter((candidate) => candidate.territoryId === id)
            .length > territory.sites[kind].count
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
