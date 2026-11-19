import { HEX_NEIGHBORS } from "../TerritoryHexGeometry";
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

function surfaceHeight(cell: BurningTerrain, x: number, z: number): number {
  let height = cell.position[1];
  const parts = cell.model.parts;
  for (const part of parts) {
    // Forest emitters are rooted in the soil beneath the surviving snags.
    if (cell.wildfire.forest && !part.receivesShadow) continue;
    const { normals, positions } = part.mesh;
    const [ox, oy, oz] = part.position ?? [0, 0, 0];
    const px = x - cell.position[0] - ox;
    const pz = z - cell.position[2] - oz;
    for (let i = 0; i < positions.length; i += 9) {
      if (normals[i + 1] <= 0.001) continue;
      const ax = positions[i],
        az = positions[i + 2];
      const bx = positions[i + 3],
        bz = positions[i + 5];
      const cx = positions[i + 6],
        cz = positions[i + 8];
      const area = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(area) < 1e-8) continue;
      const a = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / area;
      const b = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / area;
      const c = 1 - a - b;
      if (Math.min(a, b, c) < -1e-6) continue;
      height = Math.max(
        height,
        cell.position[1] +
          oy +
          a * positions[i + 1] +
          b * positions[i + 4] +
          c * positions[i + 7],
      );
    }
  }
  return height;
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
  const y = Math.max(
    surfaceHeight(cell, x, z),
    other ? surfaceHeight(other, x, z) : 0,
  );
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
