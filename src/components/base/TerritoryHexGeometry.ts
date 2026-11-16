/** Shared board projection. Artwork uses a 500-square canvas; only terrain is flattened. */
export const HEX_WIDTH = 128;
export const HEX_HEIGHT = HEX_WIDTH * 0.72;
export const HEX_NEIGHBORS = [
  [1, -1],
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
] as const;
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
export const occupantTerminal = (tile: HexPosition): MapPoint => {
  const ground = groundAnchor(tile);
  return { x: ground.x, y: ground.y - (15 * HEX_WIDTH) / 500 };
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
export const hexRimPath = `M${-HEX_WIDTH / 2} ${HEX_HEIGHT / 4}L0 ${HEX_HEIGHT / 2}L${HEX_WIDTH / 2} ${HEX_HEIGHT / 4}V${HEX_HEIGHT / 4 + 6}L0 ${HEX_HEIGHT / 2 + 6}L${-HEX_WIDTH / 2} ${HEX_HEIGHT / 4 + 6}Z`;
const corners = [
  [0, -HEX_HEIGHT / 2],
  [HEX_WIDTH / 2, -HEX_HEIGHT / 4],
  [HEX_WIDTH / 2, HEX_HEIGHT / 4],
  [0, HEX_HEIGHT / 2],
  [-HEX_WIDTH / 2, HEX_HEIGHT / 4],
  [-HEX_WIDTH / 2, -HEX_HEIGHT / 4],
] as const;
const key = ({ q, r }: Pick<HexPosition, "q" | "r">) => `${q},${r}`;
const pointText = ({ x, y }: MapPoint) =>
  `${Math.round(x * 1000) / 1000} ${Math.round(y * 1000) / 1000}`;

/** Outline only exposed edges, so adjacent cells of one company share a single border. */
export function hexBoundary<T extends HexPosition>(
  tiles: readonly T[],
  include: (tile: T) => boolean,
): string {
  const included = new Set(tiles.filter(include).map(key));
  return tiles
    .filter(include)
    .flatMap((tile) => {
      const center = hexCenter(tile);
      return HEX_NEIGHBORS.flatMap(([dq, dr], edge) => {
        if (included.has(key({ q: tile.q + dq, r: tile.r + dr }))) return [];
        const from = corners[edge],
          to = corners[(edge + 1) % 6];
        return [
          `M${pointText({ x: center.x + from[0], y: center.y + from[1] })}L${pointText({ x: center.x + to[0], y: center.y + to[1] })}`,
        ];
      });
    })
    .join(" ");
}
export interface HexWire<Id extends string = string> {
  id: string;
  from: Id;
  to: Id;
  crossing: MapPoint;
  path: string;
}
/** One automatic path per adjacent developed pair, with a shared crossing and hidden terminal ends. */
export function hexWires<T extends HexPosition>(
  tiles: readonly T[],
  developed: (tile: T) => boolean,
  connected: (a: T, b: T) => boolean = () => true,
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
        const from = hexCenter(tile),
          to = hexCenter(other);
        const crossing = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
        const points = [
          occupantTerminal(tile),
          groundAnchor(tile),
          crossing,
          groundAnchor(other),
          occupantTerminal(other),
        ];
        return [
          {
            id: `${tile.id}|${other.id}`,
            from: tile.id,
            to: other.id,
            crossing,
            path: points
              .map((point, index) => `${index ? "L" : "M"}${pointText(point)}`)
              .join(" "),
          },
        ];
      }),
    );
}

/** Neighboring rivers use reciprocal ports; lakes remain enclosed illustrations. */
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
