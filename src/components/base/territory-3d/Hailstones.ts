import { MeshBuilder } from "./MeshBuilder";
import { MOTION_CYCLE } from "./MotionClock";
import { rgb } from "./Palette";
import { surfaceHeight } from "./SurfaceHeight";
import type { MapModel, Vec3 } from "./Types";

export const HAIL_MODEL_KEY = "weather:hail";
export const HAILSTONE_LIMIT = { mobile: 48, desktop: 84 } as const;

const RADIUS = 0.031;
const DROP_HEIGHT = 0.68;
const IMPACT_PHASE = 0.57;
const FIRST_REBOUND = 0.24;
const SECOND_REBOUND = 0.105;

const ice = rgb("#eef8ff");
const shadedIce = rgb("#a1bfd8");
const rim: readonly Vec3[] = [
  [RADIUS, 0, 0],
  [0, 0, -RADIUS * 0.92],
  [-RADIUS * 0.93, 0, 0],
  [0, 0, RADIUS],
];
const builder = new MeshBuilder();
for (const [index, edge] of rim.entries()) {
  const next = rim[(index + 1) % rim.length];
  builder.triangle([0, RADIUS, 0], edge, next, index % 3 ? ice : shadedIce);
  builder.triangle([0, -RADIUS * 0.84, 0], next, edge, shadedIce);
}
const stone = builder.build();

// Interleave the rows and yard so individual impacts remain legible on phones.
const landingSites = [
  [-0.26, -0.19],
  [0.31, 0.31],
  [0.2, -0.02],
  [-0.41, 0.09],
  [-0.03, 0.16],
  [0.37, -0.15],
  [0.12, -0.2],
  [-0.17, 0.31],
  [0.25, 0.16],
  [-0.37, -0.29],
  [-0.13, -0.015],
  [0.38, 0.065],
] as const;

export function hailModel(
  terrain: MapModel,
  solar: MapModel,
  q: number,
  r: number,
): MapModel {
  const shift = (q * 0.13 + r * 0.29) % 1;
  return {
    key: HAIL_MODEL_KEY,
    terminals: [],
    footprint: 1,
    height: DROP_HEIGHT + solar.height + (terrain.supportY ?? 0),
    parts: landingSites.map(([x, z], index) => {
      const landing = Math.max(
        surfaceHeight(terrain, x, z),
        (terrain.supportY ?? 0) + surfaceHeight(solar, x, z),
      );
      return {
        mesh: stone,
        position: [x, landing + RADIUS, z],
        motion: "hail",
        phaseOffset: (index * 0.61803398875 + shift) / 9,
      };
    }),
  };
}

/** Accelerating fall, then two progressively shorter ballistic rebounds. */
export function hailstoneRise(age: number): number {
  if (age < IMPACT_PHASE) {
    const time = age / IMPACT_PHASE;
    return DROP_HEIGHT * (1 - time * time);
  }
  const afterImpact = age - IMPACT_PHASE;
  if (afterImpact < FIRST_REBOUND) {
    const time = afterImpact / FIRST_REBOUND;
    return 0.47 * time * (1 - time);
  }
  if (afterImpact < FIRST_REBOUND + SECOND_REBOUND) {
    const time = (afterImpact - FIRST_REBOUND) / SECOND_REBOUND;
    return 0.095 * time * (1 - time);
  }
  return 0;
}

export function hailstoneAge(phase: number): number {
  const cycles = (phase / MOTION_CYCLE) * 9;
  return cycles - Math.floor(cycles);
}
