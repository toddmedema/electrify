import type { TerritoryTileView } from "../../../helpers/TerritoryMapState";
import { territoryOwnerColor } from "../TerritoryMapLayout";
import { HEX_NEIGHBORS } from "../TerritoryHexGeometry";
import { MeshBuilder } from "./MeshBuilder";
import { rgb } from "./Palette";
import { GROUND_HEX_CORNERS, tilePosition3D } from "./Projection";
import type { MapInstance, RGB, Vec3 } from "./Types";

type BorderTile = Pick<TerritoryTileView, "tile" | "ownerKey">;
const ORIGIN: Vec3 = [0, 0, 0];
const OWNERSHIP_Y = 0.005;
const SELECTION_Y = 0.012;
const EDGE_ENDS = [0, 1] as const;
const DASHES = [
  [0.05, 0.42],
  [0.58, 0.95],
] as const;

function ribbon(
  builder: MeshBuilder,
  origin: Vec3,
  edge: number,
  ends: readonly [number, number],
  width: number,
  inset: boolean,
  y: number,
  color: RGB,
) {
  const [x, z] = GROUND_HEX_CORNERS[edge];
  const [nextX, nextZ] = GROUND_HEX_CORNERS[(edge + 1) % 6];
  const dx = nextX - x;
  const dz = nextZ - z;
  const length = Math.hypot(dx, dz);
  const outside = inset ? 0 : -width / 2;
  const inside = outside + width;
  const point = (along: number, inward: number): Vec3 => [
    origin[0] + x + dx * along - (dz * inward) / length,
    y,
    origin[2] + z + dz * along + (dx * inward) / length,
  ];
  builder.quad(
    point(ends[0], outside),
    point(ends[0], inside),
    point(ends[1], inside),
    point(ends[1], outside),
    color,
  );
}

function borderInstance(
  id: string,
  builder: MeshBuilder,
  position: Vec3,
  footprint: number,
): MapInstance {
  return {
    id,
    position,
    active: false,
    fog: 0,
    model: {
      key: id,
      parts: [{ mesh: builder.build(), material: "map-border" }],
      footprint,
      height: SELECTION_Y + 0.001,
      terminals: [],
    },
  };
}

/** One unlit, depth-tested mesh for the board's ownership edges. */
export function buildOwnershipBorder(
  tiles: readonly BorderTile[],
  palette: Readonly<Record<string, string>>,
  peerColors: Readonly<Record<string, string>>,
  dark: boolean,
): MapInstance | undefined {
  const owners = new Map(
    tiles.map(({ tile, ownerKey }) => [`${tile.q},${tile.r}`, ownerKey]),
  );
  const mesh = new MeshBuilder();
  const backing = rgb(dark ? "#0b1016" : "#ffffff");
  let footprint = 0;
  for (const { tile, ownerKey } of tiles) {
    if (!ownerKey) continue;
    const origin = tilePosition3D(tile);
    const variable = territoryOwnerColor(ownerKey, peerColors).slice(4, -1);
    const color = rgb(
      palette[variable] ?? palette["--territory-owner-municipal"],
    );
    for (const [edge, [dq, dr]] of HEX_NEIGHBORS.entries()) {
      const neighbor = owners.get(`${tile.q + dq},${tile.r + dr}`);
      if (neighbor === ownerKey) continue;
      // Each utility paints its own side of a shared edge without coplanar overlap.
      const inset = neighbor !== undefined;
      ribbon(mesh, origin, edge, EDGE_ENDS, 0.054, inset, OWNERSHIP_Y, backing);
      ribbon(
        mesh,
        origin,
        edge,
        EDGE_ENDS,
        0.026,
        inset,
        OWNERSHIP_Y + 0.001,
        color,
      );
      footprint = Math.max(
        footprint,
        Math.abs(origin[0]) + 1,
        Math.abs(origin[2]) + 1,
      );
    }
  }
  if (footprint)
    return borderInstance("border:ownership", mesh, ORIGIN, footprint);
}

const selectionBorder = (() => {
  const mesh = new MeshBuilder();
  const backing = rgb("#17252c");
  const color = rgb("#fff8e1");
  for (let edge = 0; edge < GROUND_HEX_CORNERS.length; edge++) {
    for (const ends of DASHES) {
      ribbon(mesh, ORIGIN, edge, ends, 0.044, false, SELECTION_Y, backing);
      ribbon(mesh, ORIGIN, edge, ends, 0.02, false, SELECTION_Y + 0.001, color);
    }
  }
  return borderInstance("border:selection", mesh, ORIGIN, 1.2);
})();

/** Move the same dashed ring without rebuilding either border mesh. */
export function buildSelectionBorder(tile: BorderTile["tile"]): MapInstance {
  return { ...selectionBorder, position: tilePosition3D(tile) };
}
