import type { TerrainType } from "../../../Types";
import { MeshBuilder } from "./MeshBuilder";
import { PALETTE } from "./Palette";
import { GROUND_HEX_CORNERS as HEX } from "./Projection";
import type { MapModel, RGB, Vec3 } from "./Types";

/** A strand is a narrow beach without spits, beside wide facilities. */
export type CoastStyle = "beach" | "strand" | "cliff";
type Point = readonly [number, number];

const SEGMENTS = 8;
const SIN_60 = Math.sqrt(3) / 2;
/** Above farm fields (0.0015) and below the projected shadow plane (0.003). */
const SAND_Y = 0.0025;
const BEACH_WIDTH = 0.14;
const BEACH_JUT = 0.03;
const CLIFF_WIDTH = 0.17;
const CLIFF_HEIGHT = 0.1;
/** Rim height, as a share of CLIFF_HEIGHT, where the cliff meets a land edge. */
const CLIFF_GULLY = 0.2;
const CLIFF_JUT = 0.02;
/** Below the ocean surface, so every trim meets the water without a visible seam. */
const SUBMERGED_Y = -0.02;

const cache = new Map<string, MapModel>();

/** Integer hash in [0, 1): identical on every platform, unlike transcendental noise. */
function jitter(edge: number, segment: number, salt: number) {
  let h = Math.imul(
    edge * 73 + segment * 151 + salt * 199 + 0x9e37,
    0x85ebca6b,
  );
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Corners keep fixed ends. A band ending where the next edge also faces the sea
 * mitres along the corner's bisector. Otherwise it ends on the shared land edge,
 * where the neighbouring tile's band continues the shoreline at the same profile.
 */
function edgeFrame(edge: number, edges: number) {
  const a = HEX[edge],
    b = HEX[(edge + 1) % 6];
  const previous = HEX[(edge + 5) % 6],
    next = HEX[(edge + 2) % 6];
  const corner = ([x, z]: Point): Point => {
    const length = Math.hypot(x, z);
    return [x / length / SIN_60, z / length / SIN_60];
  };
  const along = (from: Point, to: Point): Point => {
    const length = Math.hypot(from[0] - to[0], from[1] - to[1]);
    return [
      (from[0] - to[0]) / length / SIN_60,
      (from[1] - to[1]) / length / SIN_60,
    ];
  };
  const startOffset =
    edges & (1 << ((edge + 5) % 6)) ? corner(a) : along(a, previous);
  const endOffset =
    edges & (1 << ((edge + 1) % 6)) ? corner(b) : along(b, next);
  /** Ground point at fraction t along the edge, `s` tile widths outward from it. */
  return (t: number, s: number): Point => [
    a[0] +
      (b[0] - a[0]) * t +
      (startOffset[0] + (endOffset[0] - startOffset[0]) * t) * s,
    a[1] +
      (b[1] - a[1]) * t +
      (startOffset[1] + (endOffset[1] - startOffset[1]) * t) * s,
  ];
}

/** Flat-shaded quad whose normal faces `toward`, whatever the corner order. */
function facing(
  builder: MeshBuilder,
  [a, b, c, d]: readonly Vec3[],
  color: RGB,
  toward: Vec3,
) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
    v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const normal = [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
  const flipped =
    normal[0] * toward[0] + normal[1] * toward[1] + normal[2] * toward[2] < 0;
  if (flipped) builder.quad(a, d, c, b, color);
  else builder.quad(a, b, c, d, color);
}

const UP: Vec3 = [0, 1, 0];
const lift = ([x, z]: Point, y: number): Vec3 => [x, y, z];
// Peaks in the middle of an edge and vanishes at the corners neighbours share.
const bump = (t: number) => 4 * t * (1 - t);

const mixColor = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const SUNLIT_TURF: RGB = [0xd8 / 255, 0xe0 / 255, 0xb8 / 255];

/** Rows of ground points across one edge, joined segment by segment into quads. */
function strip(
  builder: MeshBuilder,
  rows: (t: number, k: number) => Vec3[],
  colors: readonly (RGB | ((segment: number) => RGB))[],
  normals: readonly Vec3[],
) {
  let previous = rows(0, 0);
  const first = previous;
  for (let k = 1; k <= SEGMENTS; k++) {
    const current = rows(k / SEGMENTS, k);
    for (let row = 0; row < colors.length; row++)
      facing(
        builder,
        [previous[row], current[row], current[row + 1], previous[row + 1]],
        typeof colors[row] === "function"
          ? (colors[row] as (segment: number) => RGB)(k)
          : (colors[row] as RGB),
        normals[row],
      );
    previous = current;
  }
  return [first, previous];
}

function beach(
  builder: MeshBuilder,
  edge: number,
  edges: number,
  width: number,
  reachOut: number,
) {
  const at = edgeFrame(edge, edges);
  strip(
    builder,
    (t, k) => {
      const swell = bump(t);
      const jut = reachOut * swell * (0.35 + 0.65 * jitter(edge, k, 1));
      // Two octaves keep the dune line from following the hex edge.
      const reach =
        width *
        (1 +
          0.8 * swell * (jitter(edge, k, 2) - 0.5) +
          0.45 * swell * (jitter(edge, k >> 1, 7) - 0.5));
      const wet = 0.3 + 0.1 * swell * jitter(edge, k, 6);
      return [
        lift(at(t, -reach - 0.014), SAND_Y),
        lift(at(t, -reach), SAND_Y),
        lift(at(t, -reach * wet + jut * 0.6), SAND_Y),
        lift(at(t, jut), 0.0012),
        lift(at(t, jut + 0.008), 0.0004),
        lift(at(t, jut + 0.035), SUBMERGED_Y),
      ];
    },
    [
      PALETTE.duneGrass,
      PALETTE.sand,
      PALETTE.wetSand,
      PALETTE.surf,
      PALETTE.wetSand,
    ],
    [UP, UP, UP, UP, UP],
  );
}

function cliff(builder: MeshBuilder, edge: number, edges: number, top: RGB) {
  const at = edgeFrame(edge, edges);
  const [ax, az] = HEX[edge],
    [bx, bz] = HEX[(edge + 1) % 6];
  const outward: Vec3 = [(ax + bx) * 2, 0.35, (az + bz) * 2];
  // Where the next edge is land the rim dips into a gully, so a neighbouring
  // cliff continues at the same height and a neighbouring beach meets a low cap.
  const mitred = [
    (edges & (1 << ((edge + 5) % 6))) !== 0,
    (edges & (1 << ((edge + 1) % 6))) !== 0,
  ];
  const [start, end] = strip(
    builder,
    (t, k) => {
      const corner = k === 0 ? 0 : k === SEGMENTS ? 1 : -1;
      // Ease the rim down toward a gully over the last 40% of the edge.
      const ease = (distance: number, open: boolean) => {
        if (open) return 1;
        const f = Math.min(1, distance / 0.4);
        return CLIFF_GULLY + (1 - CLIFF_GULLY) * f * f * (3 - 2 * f);
      };
      const envelope = ease(t, mitred[0]) * ease(1 - t, mitred[1]);
      const height =
        CLIFF_HEIGHT *
        envelope *
        (corner < 0 ? 0.8 + 0.5 * jitter(edge, k, 3) : 1);
      const jut = CLIFF_JUT * bump(t) * (0.3 + 0.7 * jitter(edge, k, 4));
      const ledge = corner < 0 ? 0.012 + 0.008 * jitter(edge, k, 5) : 0.016;
      return [
        lift(at(t, -CLIFF_WIDTH), 0),
        lift(at(t, -CLIFF_WIDTH * 0.25 + jut * 0.5), height * 0.82),
        lift(at(t, jut - 0.016), height),
        lift(at(t, jut + 0.004), height * 0.97),
        lift(at(t, jut + ledge), height * 0.46),
        lift(at(t, jut + 0.026), 0.004),
        lift(at(t, jut + 0.034), 0.0008),
        lift(at(t, jut + 0.042), SUBMERGED_Y),
      ];
    },
    [
      top,
      mixColor(top, SUNLIT_TURF, 0.25),
      PALETTE.cliffLip,
      PALETTE.cliffFace,
      PALETTE.cliffFaceShade,
      PALETTE.cliffBase,
      // Broken surf where waves meet the cliff foot.
      (segment) =>
        jitter(edge, segment, 8) < 0.6 ? PALETTE.surf : PALETTE.cliffBase,
    ],
    [UP, UP, UP, outward, outward, outward, UP],
  );
  // Close the ridge where it may meet a lower beach on the next tile.
  [start, end].forEach((profile, index) => {
    if (mitred[index]) return;
    const away: Vec3 = index ? [bx - ax, 0, bz - az] : [ax - bx, 0, az - bz];
    const base = [profile[0][0], SUBMERGED_Y, profile[0][2]] as Vec3;
    for (let i = 1; i < profile.length - 1; i++)
      facing(
        builder,
        [base, profile[i], profile[i + 1], profile[i + 1]],
        PALETTE.cliffFace,
        away,
      );
  });
}

/** Trim for a land tile's sea-facing edges, shared by every tile with the same edges. */
export function getCoastModel(
  style: CoastStyle,
  edges: number,
  top: RGB = PALETTE.grass,
): MapModel {
  const topKey =
    style === "cliff" && top !== PALETTE.grass ? `:${top.join(",")}` : "";
  const key = `coast:${style}:${edges & 63}${topKey}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const builder = new MeshBuilder();
  for (let edge = 0; edge < 6; edge++)
    if (edges & (1 << edge))
      if (style === "cliff") cliff(builder, edge, edges, top);
      else if (style === "strand") beach(builder, edge, edges, 0.095, 0);
      else beach(builder, edge, edges, BEACH_WIDTH, BEACH_JUT);
  const model: MapModel = {
    key,
    parts: [
      {
        mesh: builder.build(),
        castsShadow: style === "cliff",
        receivesShadow: style !== "cliff",
      },
    ],
    terminals: [],
    footprint: 1,
    height: style === "cliff" ? CLIFF_HEIGHT * 1.3 : SAND_Y,
  };
  cache.set(key, model);
  return model;
}

/** Highlands meet the sea with cliffs; low farmland and river mouths with sand. */
export function coastStyle(
  terrain: TerrainType,
  artHash: number,
  footprint: number,
): CoastStyle {
  // Wide facilities reach the shoreline: a narrow level strand keeps their pads clear.
  if (footprint > 0.65) return "strand";
  switch (terrain) {
    case "mountain":
    case "hills":
      return "cliff";
    case "forest":
      return (artHash >>> 24) & 1 ? "cliff" : "beach";
    case "plains":
      return ((artHash >>> 24) & 3) === 0 ? "cliff" : "beach";
    default:
      return "beach";
  }
}

export function coastTop(terrain: TerrainType): RGB {
  return terrain === "mountain"
    ? PALETTE.rock
    : terrain === "forest"
      ? PALETTE.grassShade
      : PALETTE.grass;
}
