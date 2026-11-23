import { HEX_NEIGHBORS } from "../../helpers/HexNeighbors";

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

/** Neighboring rivers use reciprocal ports; lakes stay enclosed. */
export function riverPorts<T extends HexPosition & { terrain: string }>(
  tile: T,
  tiles: readonly T[],
): number[] {
  const water = new Set(
    tiles
      .filter((other) => other.terrain === "river" || other.terrain === "ocean")
      .map(key),
  );
  const ports = HEX_NEIGHBORS.flatMap(([dq, dr], edge) =>
    water.has(key({ q: tile.q + dq, r: tile.r + dr })) ? [edge] : [],
  );
  return ports.length ? ports : [0, 3];
}
