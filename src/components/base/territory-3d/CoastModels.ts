import type { TerrainType } from "../../../Types";
import { MeshBuilder } from "./MeshBuilder";
import { PALETTE } from "./Palette";
import { GROUND_HEX_CORNERS as HEX } from "./Projection";
import type { MapModel, RGB, Vec3 } from "./Types";

export type CoastStyle = "beach" | "cliff";
type Point = readonly [number, number];

const SEGMENTS = 8;
const SIN_60 = Math.sqrt(3) / 2;
/** Above farm fields (0.0015) and below the projected shadow plane (0.003). */
const SAND_Y = 0.0025;
const BEACH_WIDTH = 0.1;
const BEACH_JUT = 0.03;
const CLIFF_WIDTH = 0.13;
const CLIFF_HEIGHT = 0.05;
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

function beach(builder: MeshBuilder, edge: number, edges: number) {
  const at = edgeFrame(edge, edges);
  const rows = (t: number, k: number) => {
    const jut = BEACH_JUT * bump(t) * (0.35 + 0.65 * jitter(edge, k, 1));
    const reach =
      BEACH_WIDTH * (1 + 0.6 * bump(t) * (jitter(edge, k, 2) - 0.4));
    return [
      lift(at(t, -reach), SAND_Y),
      lift(at(t, -reach * 0.18 + jut * 0.6), SAND_Y),
      lift(at(t, jut), 0.0012),
      lift(at(t, jut + 0.035), SUBMERGED_Y),
    ];
  };
  const colors = [PALETTE.sand, PALETTE.wetSand, PALETTE.wetSand];
  let previous = rows(0, 0);
  for (let k = 1; k <= SEGMENTS; k++) {
    const current = rows(k / SEGMENTS, k);
    for (let row = 0; row < 3; row++)
      facing(
        builder,
        [previous[row], current[row], current[row + 1], previous[row + 1]],
        colors[row],
        UP,
      );
    previous = current;
  }
}

function cliff(builder: MeshBuilder, edge: number, edges: number, top: RGB) {
  const at = edgeFrame(edge, edges);
  const [nx, nz] = [
    (HEX[edge][0] + HEX[(edge + 1) % 6][0]) * 2 * SIN_60,
    (HEX[edge][1] + HEX[(edge + 1) % 6][1]) * 2 * SIN_60,
  ];
  const outward: Vec3 = [nx, 0.35, nz];
  const rows = (t: number, k: number) => {
    const end = k === 0 || k === SEGMENTS;
    const height = end
      ? CLIFF_HEIGHT
      : CLIFF_HEIGHT * (0.6 + 0.8 * jitter(edge, k, 3));
    const jut = CLIFF_JUT * bump(t) * (0.3 + 0.7 * jitter(edge, k, 4));
    const ledge = end ? 0.006 : 0.004 + 0.006 * jitter(edge, k, 5);
    return [
      lift(at(t, -CLIFF_WIDTH), 0),
      lift(at(t, -CLIFF_WIDTH * 0.42 + jut * 0.5), height * 0.82),
      lift(at(t, jut - 0.006), height),
      lift(at(t, jut + ledge), height * 0.46),
      lift(at(t, jut + 0.016), SUBMERGED_Y),
    ];
  };
  const colors = [top, top, PALETTE.rockShade, PALETTE.cliffFace];
  const normals: Vec3[] = [UP, UP, outward, outward];
  const ends: Vec3[][] = [];
  let previous = rows(0, 0);
  ends.push(previous);
  for (let k = 1; k <= SEGMENTS; k++) {
    const current = rows(k / SEGMENTS, k);
    for (let row = 0; row < 4; row++)
      facing(
        builder,
        [previous[row], current[row], current[row + 1], previous[row + 1]],
        colors[row],
        normals[row],
      );
    previous = current;
  }
  ends.push(previous);
  // Close the ridge where a neighbouring tile might continue with a low beach.
  const [ax, az] = HEX[edge],
    [bx, bz] = HEX[(edge + 1) % 6];
  ends.forEach((profile, index) => {
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
  const topKey = top === PALETTE.grass ? "" : `:${top.join(",")}`;
  const key = `coast:${style}:${edges & 63}${topKey}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const builder = new MeshBuilder();
  for (let edge = 0; edge < 6; edge++)
    if (edges & (1 << edge))
      if (style === "beach") beach(builder, edge, edges);
      else cliff(builder, edge, edges, top);
  const model: MapModel = {
    key,
    parts: [
      {
        mesh: builder.build(),
        castsShadow: style === "cliff",
        receivesShadow: style === "beach",
      },
    ],
    terminals: [],
    footprint: 1,
    height: style === "cliff" ? CLIFF_HEIGHT * 1.28 : SAND_Y,
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
  // Wide facilities reach the shoreline; a level beach keeps their pads clear.
  if (footprint > 0.65) return "beach";
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
