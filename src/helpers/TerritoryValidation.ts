import { TICK_MINUTES } from "../Constants";
import type { GameType } from "../Types";
import { isTerritoryId } from "../data/Territories";
import { UTILITY_AREAS } from "../data/UtilityExpansion";
import { isUtilityExpansionGame } from "./ExpansionContext";
import {
  facilityTerritoryId,
  ownedTerritories,
  landPrice,
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
      game.timeline.every((tick) => tick.territories === undefined)
    );
  if (
    !record(game.territoryNetwork) ||
    game.territoryNetwork.version !== 2 ||
    Object.keys(game.territoryNetwork).length !== 3
  )
    return false;
  const state = game.territoryNetwork;
  if (
    !Array.isArray(state.landPurchases) ||
    state.landPurchases.length > 1 ||
    !Array.isArray(state.legacyConnections) ||
    state.legacyConnections.length > 16
  )
    return false;
  for (const receipt of state.landPurchases) {
    if (
      !record(receipt) ||
      receipt.territoryId !== "green-uplands" ||
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
        !line ||
        line.minuteCreated !== receipt.minute ||
        line.buildCost !== receipt.price ||
        Object.keys(receipt).length !== 4
      )
        return false;
    } else if (
      receipt.legacy !== undefined ||
      Object.keys(receipt).length !== 3 ||
      !close(receipt.price, landPrice(game, receipt.minute))
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
  if (
    game.facilities.some((facility) => {
      if (
        facility.territoryId !== undefined &&
        !isTerritoryId(facility.territoryId)
      )
        return true;
      const id = facilityTerritoryId(facility);
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
