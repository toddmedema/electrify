import { closestHexEdge, HEX_NEIGHBORS } from "../../helpers/HexNeighbors";

/** Shared board projection for the scene and its HTML and SVG overlays. */
export const HEX_WIDTH = 128;
export const HEX_HEIGHT = HEX_WIDTH * 0.72;
export { HEX_NEIGHBORS };
export interface HexPosition {
  id: string;
  q: number;
  r: number;
}
export interface MapPoint {
  x: number;
  y: number;
}
export const hexCenter = ({
  q,
  r,
}: Pick<HexPosition, "q" | "r">): MapPoint => ({
  x: HEX_WIDTH * q + (HEX_WIDTH / 2) * r,
  y: ((3 * HEX_HEIGHT) / 4) * r,
});
export const groundAnchor = (tile: HexPosition): MapPoint => {
  const center = hexCenter(tile);
  return { x: center.x, y: center.y + (115 * HEX_HEIGHT) / 500 };
};
export const foregroundOrigin = (tile: HexPosition): MapPoint => {
  const ground = groundAnchor(tile);
  return {
    x: ground.x - HEX_WIDTH / 2,
    y: ground.y - (365 * HEX_WIDTH) / 500,
  };
};
export const hexFacePath = [
  `M0 ${-HEX_HEIGHT / 2}`,
  `L${HEX_WIDTH / 2} ${-HEX_HEIGHT / 4}`,
  `V${HEX_HEIGHT / 4}`,
  `L0 ${HEX_HEIGHT / 2}`,
  `L${-HEX_WIDTH / 2} ${HEX_HEIGHT / 4}`,
  `V${-HEX_HEIGHT / 4}Z`,
].join(" ");
const key = ({ q, r }: Pick<HexPosition, "q" | "r">) => `${q},${r}`;

export interface HexWire<Id extends string = string> {
  id: string;
  from: Id;
  to: Id;
  kind: "overhead" | "submerged";
}
/** One visual link per adjacency: suspended conductors on land, buried cables across open water. */
export function hexWires<T extends HexPosition>(
  tiles: readonly T[],
  developed: (tile: T) => boolean,
  connected: (a: T, b: T) => boolean = () => true,
  submerged: (tile: T) => boolean = () => false,
): HexWire<T["id"]>[] {
  const indexed = new Map(
    tiles.filter(developed).map((tile) => [key(tile), tile]),
  );
  return [...indexed.values()]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .flatMap((tile) =>
      HEX_NEIGHBORS.flatMap(([dq, dr]) => {
        const other = indexed.get(key({ q: tile.q + dq, r: tile.r + dr }));
        if (!other || tile.id >= other.id || !connected(tile, other)) return [];
        return [
          {
            id: `${tile.id}|${other.id}`,
            from: tile.id,
            to: other.id,
            kind:
              submerged(tile) || submerged(other) ? "submerged" : "overhead",
          },
        ];
      }),
    );
}

/** Shore openings use the same edge on both tiles. At a map edge a river
 * continues across an exposed edge. */
export function waterPorts(
  tile: Pick<HexPosition, "q" | "r"> & { terrain: string },
  terrainAt: ReadonlyMap<string, string>,
  offMapRiverEdge?: number | null,
): number[] {
  const neighbors = HEX_NEIGHBORS.map(([dq, dr]) =>
    terrainAt.get(key({ q: tile.q + dq, r: tile.r + dr })),
  );
  const edges = (matches: (terrain: string | undefined) => boolean) =>
    neighbors.flatMap((terrain, index) => (matches(terrain) ? [index] : []));
  const rivers = edges((terrain) => terrain === "river");
  if (tile.terrain === "lake") return rivers;

  const lakes = edges((terrain) => terrain === "lake");
  const coast = edges((terrain) => terrain === "ocean");
  const opposite = ((rivers[0] ?? 3) + 3) % HEX_NEIGHBORS.length;
  const mouth = closestHexEdge(coast, opposite);
  const ports = [...rivers, ...lakes, ...(mouth === undefined ? [] : [mouth])];
  if (offMapRiverEdge != null) ports.push(offMapRiverEdge);
  else if (
    offMapRiverEdge === undefined &&
    ports.length === 1 &&
    !lakes.length &&
    mouth === undefined
  ) {
    const exit = closestHexEdge(
      edges((terrain) => terrain === undefined),
      opposite,
    );
    if (exit !== undefined) ports.push(exit);
  }
  return ports.sort((a, b) => a - b);
}
