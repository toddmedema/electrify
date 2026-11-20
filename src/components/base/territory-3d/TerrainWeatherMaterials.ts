import type { MapMesh, RGB } from "./Types";
import { PALETTE, rgb } from "./Palette";

type Tint = "dry" | "parched" | "ash";
const tints: Record<Tint, WeakMap<MapMesh, MapMesh>> = {
  dry: new WeakMap(),
  parched: new WeakMap(),
  ash: new WeakMap(),
};
const ochre = rgb("#a99560");
const umber = rgb("#976943");
const charcoal = rgb("#484649");
const ashEdge = rgb("#797d75");

/** Share geometry and bounded color variants across every tile that uses the source mesh. */
export function tintTerrainMesh(mesh: MapMesh, tint: Tint): MapMesh {
  const cached = tints[tint].get(mesh);
  if (cached) return cached;
  const colors = mesh.colors.slice();
  const dryBlend = tint === "dry" ? 0.63 : 0.83;
  for (let i = 0; i < colors.length; i += 3) {
    const source: RGB = [colors[i], colors[i + 1], colors[i + 2]];
    let target = tint === "dry" ? ochre : umber;
    let blend = dryBlend;
    if (tint === "ash") {
      const x = mesh.positions[i];
      const z = mesh.positions[i + 2];
      // Leave remnants of the source color around the charred interior and break its symmetry.
      const center = Math.max(
        0,
        1 - Math.hypot(x + z * 0.19, z - 0.035) * 1.95,
      );
      target = center > 0.12 ? charcoal : ashEdge;
      blend = 0.63 + 0.29 * center;
    } else if (
      ![PALETTE.forest, PALETTE.forestLight].some((color) =>
        color.every(
          (channel, index) => Math.abs(channel - source[index]) < 0.00001,
        ),
      )
    ) {
      continue;
    }
    for (let channel = 0; channel < 3; channel++)
      colors[i + channel] =
        source[channel] * (1 - blend) + target[channel] * blend;
  }
  const result = { ...mesh, colors };
  tints[tint].set(mesh, result);
  return result;
}
