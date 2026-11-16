import type { TerritoryId } from "../../Types";
import { TERRITORIES } from "../../data/Territories";
import type { TerritoryTileDefinition } from "../../data/TerritoryTiles";
import { TERRAIN_LABELS } from "../../data/TerrainLabels";
export function territoryMapLabel(id: TerritoryId): string {
  if (id === "champlain") return "You";
  const territory = TERRITORIES.find((territory) => territory.id === id);
  if (territory?.kind !== "greenfield") return territory?.name ?? "Territory";
  const ordinal =
    id === "green-uplands" ? 1 : Number(id.slice("parcel-".length)) + 2;
  return `${territory.name} · Parcel ${ordinal}`;
}
export function territoryTileLabel(tile: TerritoryTileDefinition): string {
  if (tile.city)
    return `${TERRAIN_LABELS[tile.terrain]} · ${tile.city.sector === "industrial" ? "Industrial" : "Residential"} city`;
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
