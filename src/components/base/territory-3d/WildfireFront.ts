import { HEX_NEIGHBORS } from "../TerritoryHexGeometry";
import { surfaceHeight } from "./SurfaceHeight";
import type { MapInstance, Vec3 } from "./Types";

export type BurningTerrain = MapInstance & {
  wildfire: NonNullable<MapInstance["wildfire"]>;
};

export interface WildfireEmitter {
  origin: Vec3;
  seed: number;
  strength: number;
  fog: MapInstance["fog"];
}

export function isBurningTerrain(
  instance: MapInstance,
): instance is BurningTerrain {
  return instance.wildfire !== undefined;
}

/** Stable presentation-only jitter keyed to world coordinates, edges and slots. */
export function fireVariation(seed: number, slot: number): number {
  let value = Math.imul(seed ^ slot, 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return ((value ^ (value >>> 16)) >>> 0) / 0x100000000;
}

function emitter(
  cell: BurningTerrain,
  x: number,
  z: number,
  seed: number,
  fog = cell.fog,
  scale = 1,
  other?: BurningTerrain,
): WildfireEmitter {
  // Forest emitters are rooted in the soil beneath the surviving snags.
  const height = ({ model, position, wildfire }: BurningTerrain) =>
    position[1] +
    surfaceHeight(model, x - position[0], z - position[2], wildfire.forest);
  const y = Math.max(height(cell), other ? height(other) : 0);
  return {
    origin: [x, y + 0.012, z],
    seed,
    strength: scale * (0.68 + fireVariation(seed, 5) * 0.47),
    fog,
  };
}

/** Seed the terrain and connect both sides of each active seam once. */
export function buildWildfireEmitters(
  burning: readonly BurningTerrain[],
): WildfireEmitter[] {
  const cells = [...burning].sort(
    (a, b) => a.wildfire.q - b.wildfire.q || a.wildfire.r - b.wildfire.r,
  );
  const byCoordinate = new Map(
    cells.map((cell) => [`${cell.wildfire.q},${cell.wildfire.r}`, cell]),
  );
  const emitters: WildfireEmitter[] = [];
  for (const cell of cells) {
    const { q, r, clearance } = cell.wildfire;
    const [x, , z] = cell.position;
    const tileSeed =
      Math.imul(q + 71, 0x27d4eb2d) ^ Math.imul(r + 37, 0x9e3779b9);
    const rotation = fireVariation(tileSeed, 2) * Math.PI * 2;
    const pad = Math.min(clearance, 0.29);
    for (let i = 0; i < 10; i++) {
      const seed = tileSeed ^ (i * 137 + 17);
      const angle =
        rotation + ((i + fireVariation(seed, 2) * 0.83) * Math.PI * 2) / 10;
      const dx = Math.cos(angle),
        dz = Math.sin(angle);
      const outsidePad = pad / Math.max(Math.abs(dx), Math.abs(dz));
      const radius = Math.max(outsidePad, 0.13 + 0.31 * fireVariation(seed, 3));
      emitters.push(emitter(cell, x + dx * radius, z + dz * radius, seed));
    }
    // The first three axial directions visit each reciprocal edge once. Bridges
    // never reach across an inactive cell, even if another fire is visible behind it.
    for (let edge = 0; edge < 3; edge++) {
      const [dq, dr] = HEX_NEIGHBORS[edge];
      const next = byCoordinate.get(`${q + dq},${r + dr}`);
      if (!next) continue;
      const dx = next.position[0] - x,
        dz = next.position[2] - z;
      for (let i = 0; i < 5; i++) {
        const seed = tileSeed ^ ((edge + 1) * 3517 + i * 173);
        const along =
          0.32 +
          i * 0.09 +
          (i === 2 ? 0 : (fireVariation(seed, 7) - 0.5) * 0.045);
        const across = (fireVariation(seed, 4) - 0.5) * 0.18;
        emitters.push(
          emitter(
            cell,
            x + dx * along - dz * across,
            z + dz * along + dx * across,
            seed,
            Math.max(cell.fog, next.fog) as MapInstance["fog"],
            0.82,
            next,
          ),
        );
      }
    }
  }
  return emitters;
}
