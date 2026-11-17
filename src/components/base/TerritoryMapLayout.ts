import { citySizeLabel } from "./TerritoryTileFacts";
import type { TerritoryId } from "../../Types";
import { getTerritoryDefinition } from "../../data/Territories";
import type { TerritoryTileDefinition } from "../../data/TerritoryTiles";
import { formatCount } from "../../helpers/Format";
import { TERRAIN_LABELS } from "../../data/TerrainLabels";
export function territoryMapLabel(id: TerritoryId): string {
  if (id === "champlain") return "You";
  return getTerritoryDefinition(id)?.name ?? "Territory";
}
export function territoryTileLabel(tile: TerritoryTileDefinition): string {
  if (tile.city)
    return `${TERRAIN_LABELS[tile.terrain]} · ${citySizeLabel(tile.city.size)}`;
  if (tile.id.startsWith("frontier:"))
    return `${TERRAIN_LABELS[tile.terrain]} · Building site`;
  const ordinal = Number(tile.id.slice(tile.id.lastIndexOf("-") + 1)) + 1;
  return `${TERRAIN_LABELS[tile.terrain]} · Site ${ordinal}`;
}
/** Stable colors for the room's at most three other companies, independent of arbitrary seat IDs. */
export function territoryPeerColors(peerIds: readonly string[]) {
  return Object.fromEntries(
    [...new Set(peerIds)]
      .sort()
      .map((id, index) => [id, `var(--territory-owner-peer-${index})`]),
  );
}

/** A short usable benefit shared by painted prices and their accessible names. */
export function tilePurchaseBenefitLabel(quote: {
  benefit: "general" | "residential" | "industrial" | "hydro" | "geothermal";
  customers: number;
}): string {
  switch (quote.benefit) {
    case "residential":
    case "industrial":
      return `${formatCount(quote.customers)} customers`;
    case "hydro":
      return "Hydro site";
    case "geothermal":
      return "Geothermal site";
    default:
      return "General site";
  }
}
