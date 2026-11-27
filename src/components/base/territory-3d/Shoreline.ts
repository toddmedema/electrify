import type { TerrainType } from "../../../Types";
import { HEX_NEIGHBORS } from "../TerritoryHexGeometry";

/** Axial offsets of the first two hex rings: ring one in HEX_NEIGHBORS order, then ring two. */
export const SHORE_RING_OFFSETS: readonly (readonly [number, number])[] = [
  ...HEX_NEIGHBORS,
  [2, -2],
  [2, -1],
  [2, 0],
  [1, 1],
  [0, 2],
  [-1, 2],
  [-2, 2],
  [-2, 1],
  [-2, 0],
  [-1, -1],
  [0, -2],
  [1, -2],
];

/** Tile-local ground offsets of SHORE_RING_OFFSETS, matching tilePosition3D. */
export const SHORE_RING_POSITIONS: readonly (readonly [number, number])[] =
  SHORE_RING_OFFSETS.map(([dq, dr]) => [dq + dr / 2, (dr * Math.sqrt(3)) / 2]);

/** Any authored non-ocean tile is shoreline land; tiles off the map read as open sea. */
const isShoreLand = (terrain: TerrainType | undefined) =>
  terrain !== undefined && terrain !== "ocean";

/**
 * Bits for shoreline land within two rings of an ocean tile. A land tile three
 * rings away is at least 1.49 tile widths from any point of this tile, so a
 * water depth that saturates within that distance agrees on both sides of
 * every shared ocean edge.
 */
export function oceanShoreMask(
  q: number,
  r: number,
  terrainAt: ReadonlyMap<string, TerrainType>,
): number {
  let mask = 0;
  SHORE_RING_OFFSETS.forEach(([dq, dr], index) => {
    if (isShoreLand(terrainAt.get(`${q + dq},${r + dr}`))) mask |= 1 << index;
  });
  return mask;
}

/** Edges, in HEX_NEIGHBORS order, where a land tile meets the ocean. */
export function coastEdges(
  q: number,
  r: number,
  terrainAt: ReadonlyMap<string, TerrainType>,
): number {
  return HEX_NEIGHBORS.reduce(
    (edges, [dq, dr], edge) =>
      terrainAt.get(`${q + dq},${r + dr}`) === "ocean"
        ? edges | (1 << edge)
        : edges,
    0,
  );
}
