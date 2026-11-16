import type { LandTerritoryId, TerritoryId, UtilityId } from "../../Types";
import { TERRITORIES } from "../../data/Territories";
import type { TerritoryTileArtKind } from "./TerritoryTileArt";

export interface MapTile {
  q: number;
  r: number;
  territory: TerritoryId;
  kind: TerritoryTileArtKind;
  landmark?: boolean;
}
export const MAP_WIDTH = 1040;
export const MAP_HEIGHT = 600;
export const mapCenter = ({ q, r }: Pick<MapTile, "q" | "r">) => ({
  x: 520 + 128 * q + 64 * r,
  y: 300 + 57 * r,
});
const core: readonly MapTile[] = [
  { q: 0, r: -2, territory: "champlain", kind: "lake", landmark: true },
  { q: 1, r: -2, territory: "champlain", kind: "hills", landmark: true },
  { q: 2, r: -2, territory: "ridge-electric", kind: "hills", landmark: true },
  { q: -1, r: -1, territory: "champlain", kind: "plains" },
  { q: 0, r: -1, territory: "champlain", kind: "town", landmark: true },
  {
    q: 1,
    r: -1,
    territory: "ridge-electric",
    kind: "industry",
    landmark: true,
  },
  { q: 2, r: -1, territory: "ridge-electric", kind: "hills" },
  { q: -2, r: 0, territory: "champlain", kind: "plains" },
  { q: -1, r: 0, territory: "green-uplands", kind: "land", landmark: true },
  { q: 0, r: 0, territory: "valley-electric", kind: "plains" },
  { q: 1, r: 0, territory: "ridge-electric", kind: "plains", landmark: true },
  { q: 2, r: 0, territory: "ridge-electric", kind: "hills" },
  { q: -2, r: 1, territory: "green-uplands", kind: "land" },
  { q: -1, r: 1, territory: "green-uplands", kind: "land" },
  { q: 0, r: 1, territory: "valley-electric", kind: "town", landmark: true },
  { q: 1, r: 1, territory: "valley-electric", kind: "lake", landmark: true },
  { q: -2, r: 2, territory: "green-uplands", kind: "land" },
  { q: -1, r: 2, territory: "valley-electric", kind: "plains" },
  { q: 0, r: 2, territory: "valley-electric", kind: "plains" },
];
const ring: readonly [LandTerritoryId, number, number, string][] = [
  ["parcel-0", 0, -3, "Northern edge"],
  ["parcel-1", 1, -3, "North"],
  ["parcel-2", 2, -3, "Upper northeast"],
  ["parcel-3", 3, -3, "Northeast corner"],
  ["parcel-4", 3, -2, "Northeast"],
  ["parcel-5", 3, -1, "East"],
  ["parcel-6", 3, 0, "Eastern edge"],
  ["parcel-7", 2, 1, "Southeast"],
  ["parcel-8", 1, 2, "Lower southeast"],
  ["parcel-9", 0, 3, "Southern edge"],
  ["parcel-10", -1, 3, "South"],
  ["parcel-11", -2, 3, "Lower southwest"],
  ["parcel-12", -3, 3, "Southwest corner"],
  ["parcel-13", -3, 2, "Southwest"],
  ["parcel-14", -3, 1, "Western edge"],
  ["parcel-15", -3, 0, "West"],
  ["parcel-16", -2, -1, "Northwest"],
  ["parcel-17", -1, -2, "Upper northwest"],
];
export const utilityCenters: Record<UtilityId, { x: number; y: number }> = {
  champlain: { x: 444, y: 213 },
  "ridge-electric": { x: 600, y: 213 },
  "valley-electric": { x: 584, y: 327 },
};
export function territoryMapLabel(id: TerritoryId): string {
  if (id === "champlain") return "You";
  const name =
    TERRITORIES.find((territory) => territory.id === id)?.name ?? "Territory";
  const direction =
    id === "green-uplands"
      ? "Southwest"
      : ring.find(([key]) => key === id)?.[3];
  return direction ? `${name} · ${direction}` : name;
}
export const mapTiles: readonly MapTile[] = [
  ...core,
  ...ring.map(([id, q, r]): MapTile => {
    const benefit = TERRITORIES.find(
      (territory) => territory.id === id,
    )?.benefit;
    const kind: TerritoryTileArtKind =
      benefit === "residential"
        ? "town"
        : benefit === "industrial"
          ? "industry"
          : benefit === "hydro"
            ? "lake"
            : benefit === "geothermal"
              ? "geothermal"
              : "land";
    return { q, r, territory: id, kind, landmark: true };
  }),
];
const corners = [
  [0, -38],
  [64, -19],
  [64, 19],
  [0, 38],
  [-64, 19],
  [-64, -19],
] as const;
const neighbors = [
  [1, -1],
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
] as const;
/** Adjacent owned parcels share an outer border, rather than retaining internal faction seams. */
export function mapBoundary(include: (id: TerritoryId) => boolean): string {
  return mapTiles
    .filter((tile) => include(tile.territory))
    .flatMap((tile) => {
      const { x, y } = mapCenter(tile);
      return neighbors.flatMap(([dq, dr], edge) => {
        if (
          mapTiles.some(
            (other) =>
              other.q === tile.q + dq &&
              other.r === tile.r + dr &&
              include(other.territory),
          )
        )
          return [];
        const from = corners[edge],
          to = corners[(edge + 1) % 6];
        return [`M${x + from[0]} ${y + from[1]}L${x + to[0]} ${y + to[1]}`];
      });
    })
    .join(" ");
}
export function territoryMapCenter(id: TerritoryId) {
  if (id === "champlain" || id === "valley-electric" || id === "ridge-electric")
    return utilityCenters[id];
  const own = mapTiles.filter((tile) => tile.territory === id);
  return own.reduce(
    (sum, tile) => {
      const center = mapCenter(tile);
      return {
        x: sum.x + center.x / own.length,
        y: sum.y + center.y / own.length,
      };
    },
    { x: 0, y: 0 },
  );
}
