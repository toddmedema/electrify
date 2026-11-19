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
/** The quiet tower is drawn at 60% scale around the common ground anchor. */
export const TOWER_ART_TRANSFORM = { x: 100, y: 146, scale: 0.6 } as const;
export const TOWER_CROSSARM = { left: 170, right: 330, y: 220 } as const;
export type HexWireStructure =
  "tower" | "city" | "generator" | "hydro" | "storage" | "submerged";
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
/** Elevated facade entries; tower spans attach to the crossarm tip facing their neighbor. */
export const occupantTerminal = (
  tile: HexPosition,
  structure: HexWireStructure = "tower",
  toward?: HexPosition,
): MapPoint => {
  const ground = groundAnchor(tile);
  const anchors = {
    city: { x: 250, y: 280 },
    generator: { x: 250, y: 310 },
    hydro: { x: 330, y: 215 },
    storage: { x: 290, y: 325 },
    submerged: { x: 250, y: 365 },
  } as const;
  const armX = toward
    ? hexCenter(toward).x < hexCenter(tile).x
      ? TOWER_CROSSARM.left
      : TOWER_CROSSARM.right
    : 250;
  const source =
    structure === "tower"
      ? {
          x: TOWER_ART_TRANSFORM.x + armX * TOWER_ART_TRANSFORM.scale,
          y:
            TOWER_ART_TRANSFORM.y +
            TOWER_CROSSARM.y * TOWER_ART_TRANSFORM.scale,
        }
      : anchors[structure];
  return {
    x: ground.x + ((source.x - 250) * HEX_WIDTH) / 500,
    y: ground.y + ((source.y - 365) * HEX_WIDTH) / 500,
  };
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
  kind: "overhead" | "submerged";
  start: MapPoint;
  end: MapPoint;
  control?: MapPoint;
  path: string;
}
/** One visual link per adjacency: suspended conductors on land, buried cables across open water. */
export function hexWires<T extends HexPosition>(
  tiles: readonly T[],
  developed: (tile: T) => boolean,
  connected: (a: T, b: T) => boolean = () => true,
  structure: (tile: T) => HexWireStructure = () => "tower",
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
        const fromStructure = structure(tile),
          toStructure = structure(other);
        const submerged =
          fromStructure === "submerged" || toStructure === "submerged";
        const start = submerged
          ? groundAnchor(tile)
          : occupantTerminal(tile, fromStructure, other);
        const end = submerged
          ? groundAnchor(other)
          : occupantTerminal(other, toStructure, tile);
        // The quadratic midpoint sags by half this control offset, leaving clear air below it.
        const sag = Math.min(
          HEX_WIDTH * 0.12,
          Math.min(
            groundAnchor(tile).y - start.y,
            groundAnchor(other).y - end.y,
          ) * 0.6,
        );
        const control = submerged
          ? undefined
          : { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 + sag };
        return [
          {
            id: `${tile.id}|${other.id}`,
            from: tile.id,
            to: other.id,
            crossing,
            kind: submerged ? ("submerged" as const) : ("overhead" as const),
            start,
            end,
            control,
            path: `M${pointText(start)} ${control ? `Q${pointText(control)} ` : "L"}${pointText(end)}`,
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
