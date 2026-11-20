import type { MapModel } from "./Types";

/** Highest upward solid face at an X/Z point in model-local space. */
export function surfaceHeight(
  model: MapModel,
  x: number,
  z: number,
  groundOnly = false,
): number {
  let height = 0;
  const parts = model.parts;
  for (const part of parts) {
    if (part.motion || (groundOnly && !part.receivesShadow)) continue;
    const { normals, positions } = part.mesh;
    const [ox, oy, oz] = part.position ?? [0, 0, 0];
    const px = x - ox;
    const pz = z - oz;
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
        oy + a * positions[i + 1] + b * positions[i + 4] + c * positions[i + 7],
      );
    }
  }
  return height;
}
