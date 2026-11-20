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
  if (tile.city) return tile.city.name ?? citySizeLabel(tile.city.size);
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

/** The same utility colors drive SVG labels and the depth-tested map meshes. */
export const TERRITORY_OWNER_PALETTE: Record<
  "dark" | "light",
  Readonly<Record<string, string>>
> = {
  light: {
    "--territory-owner-you": "#006bbb",
    "--territory-owner-valley": "#955b22",
    "--territory-owner-ridge": "#7951a6",
    "--territory-owner-municipal": "#646e47",
    "--territory-owner-peer-0": "#32766a",
    "--territory-owner-peer-1": "#96516c",
    "--territory-owner-peer-2": "#926817",
  },
  dark: {
    "--territory-owner-you": "#62acfa",
    "--territory-owner-valley": "#d2a469",
    "--territory-owner-ridge": "#b69bdf",
    "--territory-owner-municipal": "#b0bd92",
    "--territory-owner-peer-0": "#7dc9bf",
    "--territory-owner-peer-1": "#d9a0bc",
    "--territory-owner-peer-2": "#d5be7c",
  },
};

export function territoryOwnerColor(
  id: string,
  peerColors: Readonly<Record<string, string>>,
) {
  if (id === "you") return "var(--territory-owner-you)";
  if (id === "valley-electric") return "var(--territory-owner-valley)";
  if (id === "ridge-electric") return "var(--territory-owner-ridge)";
  if (id.startsWith("municipal:")) return "var(--territory-owner-municipal)";
  return peerColors[id.slice(5)] ?? "var(--territory-owner-municipal)";
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
