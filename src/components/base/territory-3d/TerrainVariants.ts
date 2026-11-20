import { territoryCoordinateHash } from "../../../data/Territories";
import { HEX_NEIGHBORS } from "../TerritoryHexGeometry";

export function terrainArtHash(q: number, r: number) {
  const hash = territoryCoordinateHash(q, r, "terrain-art");
  return Math.imul(hash ^ (hash >>> 16), 0x85ebca6b) >>> 0;
}

const initial = (x: number, z: number) => (((x - z) % 3) + 3) % 3;
const priority = (x: number, z: number) =>
  (terrainArtHash(x, z) >>> 30) * 3 + initial(x, z);

/** Start with three alternating colors, then let each tile choose a free layout.
 * Four shuffled passes break up the lattice. The initial color breaks priority
 * ties between neighbors, so a choice depends on at most eleven earlier steps,
 * independently of which tiles a save, camera, or multiplayer peer supplies. */
export function farmLayout(
  q: number,
  r: number,
  cache: Map<string, number>,
): number {
  const key = `${q},${r}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const order = priority(q, r);
  let used = 0;
  for (const [dq, dr] of HEX_NEIGHBORS) {
    const x = q + dq,
      z = r + dr;
    const neighbor =
      priority(x, z) < order ? farmLayout(x, z, cache) : initial(x, z);
    used |= 1 << neighbor;
  }
  const free = [0, 1, 2, 3].filter((layout) => !(used & (1 << layout)));
  const layout = free[(terrainArtHash(q, r) >>> 12) % free.length];
  cache.set(key, layout);
  return layout;
}
