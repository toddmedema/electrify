import type { TerrainType } from "../../../Types";
import { OCEAN_DEPTH_REACH, OCEAN_SWELL_SHIFT } from "./OceanShader";
import { GROUND_HEX_CORNERS } from "./Projection";
import {
  coastEdges,
  oceanShoreMask,
  SHORE_RING_OFFSETS,
  SHORE_RING_POSITIONS,
} from "./Shoreline";

const hexDistance = ([q, r]: readonly [number, number]) =>
  (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
const center = (q: number, r: number) => [q + r / 2, (r * Math.sqrt(3)) / 2];

function pointToSegment(
  [px, pz]: readonly number[],
  [ax, az]: readonly number[],
  [bx, bz]: readonly number[],
) {
  const dx = bx - ax,
    dz = bz - az;
  const t = Math.max(
    0,
    Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)),
  );
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}

/** Gap between two disjoint hexes: the closest vertex-to-edge pair, either way round. */
function hexGap(q: number, r: number) {
  const [ox, oz] = center(q, r);
  const own = GROUND_HEX_CORNERS;
  const other = own.map(([x, z]) => [x + ox, z + oz]);
  let gap = Infinity;
  for (const [from, to] of [
    [own, other],
    [other, own],
  ] as const)
    for (const point of from)
      for (let i = 0; i < 6; i++)
        gap = Math.min(gap, pointToSegment(point, to[i], to[(i + 1) % 6]));
  return gap;
}

it("lists every hex within two rings exactly once, at its board position", () => {
  expect(SHORE_RING_OFFSETS).toHaveLength(18);
  expect(new Set(SHORE_RING_OFFSETS.map(String)).size).toBe(18);
  expect(
    SHORE_RING_OFFSETS.slice(0, 6).every((o) => hexDistance(o) === 1),
  ).toBe(true);
  expect(SHORE_RING_OFFSETS.slice(6).every((o) => hexDistance(o) === 2)).toBe(
    true,
  );
  SHORE_RING_OFFSETS.forEach(([q, r], index) => {
    const [x, z] = center(q, r);
    expect(SHORE_RING_POSITIONS[index][0]).toBeCloseTo(x, 12);
    expect(SHORE_RING_POSITIONS[index][1]).toBeCloseTo(z, 12);
  });
});

it("keeps ocean depth continuous across tiles that know different land", () => {
  // Each ocean tile sees land within two rings. Land one ring further out must
  // lie beyond the depth ramp, or neighbouring tiles would disagree at an edge.
  let nearestUnseen = Infinity;
  for (let q = -3; q <= 3; q++)
    for (let r = -3; r <= 3; r++)
      if (hexDistance([q, r]) === 3)
        nearestUnseen = Math.min(nearestUnseen, hexGap(q, r));
  expect(nearestUnseen).toBeGreaterThan(OCEAN_DEPTH_REACH + OCEAN_SWELL_SHIFT);
  // The second ring is needed: it reaches well inside the ramp.
  expect(hexGap(1, 1)).toBeLessThan(OCEAN_DEPTH_REACH);
});

it("marks land around an ocean tile and the sea around a coast", () => {
  const terrain = new Map<string, TerrainType>([
    ["0,0", "ocean"],
    ["1,-1", "plains"],
    ["0,1", "ocean"],
    ["-2,2", "river"],
    ["-1,0", "lake"],
  ]);
  const ring = (q: number, r: number) =>
    SHORE_RING_OFFSETS.findIndex(([dq, dr]) => dq === q && dr === r);
  // Unknown neighbours read as open sea.
  expect(oceanShoreMask(0, 0, terrain)).toBe(
    (1 << ring(1, -1)) | (1 << ring(-2, 2)) | (1 << ring(-1, 0)),
  );
  // Only ocean neighbours, not lakes or the map edge, make a coast.
  expect(coastEdges(1, -1, terrain)).toBe(1 << 3);
  expect(coastEdges(-1, 0, terrain)).toBe(1 << 1);
});
