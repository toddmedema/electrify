import { PALETTE } from "./Palette";
import { CAMERA_COS, CAMERA_SIN } from "./Projection";
import { SHORE_RING_POSITIONS } from "./Shoreline";
import type { RGB } from "./Types";

export const OCEAN_WATER_MATERIAL = 7;
/** Tile widths from land at which water reaches full depth. */
export const OCEAN_DEPTH_REACH = 1;
/** Largest shift the broad swell noise adds to the shore distance. */
export const OCEAN_SWELL_SHIFT = 0.06;

const float = (value: number) => value.toFixed(6);
const color = ([r, g, b]: RGB) => `vec3(${float(r)}, ${float(g)}, ${float(b)})`;

/**
 * Fragment functions for ocean tiles. Each instance carries a bit mask of land
 * within two rings (MapInstance.shore), so depth, caustics and surf follow the
 * true distance to the nearest land hex and stay continuous across tiles
 * without per-coastline meshes. Expects vLocal, vSurfacePosition, vMaterial,
 * the shared lighting uniforms and surfaceNoise/surfaceGrain to be declared.
 */
export const OCEAN_FRAGMENT = `
const vec2 SHORE_RING[${SHORE_RING_POSITIONS.length}] = vec2[](
  ${SHORE_RING_POSITIONS.map(([x, z]) => `vec2(${float(x)}, ${float(z)})`).join(",\n  ")}
);
const vec3 OCEAN_VIEW = vec3(0.0, ${float(CAMERA_SIN)}, ${float(CAMERA_COS)});
// Signed distance to a unit-width hex with flat sides at x = +/-0.5.
float hexEdgeDistance(vec2 p) {
  const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
  p = abs(p.yx);
  p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
  p -= vec2(clamp(p.x, -k.z * 0.5, k.z * 0.5), 0.5);
  return length(p) * sign(p.y);
}
float shoreDistance(vec2 local, uint mask) {
  float closest = 9.0;
  if (mask == 0u) return closest;
  for (int i = 0; i < ${SHORE_RING_POSITIONS.length}; i++)
    if ((mask & (1u << uint(i))) != 0u)
      closest = min(closest, hexEdgeDistance(local - SHORE_RING[i]));
  return closest;
}
// Thin bright lines where two Voronoi cells meet: light focused by a rippled surface.
float causticWeb(vec2 p) {
  vec2 cell = floor(p), offset = fract(p);
  float nearest = 8.0, second = 8.0;
  for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      vec2 site = o + vec2(surfaceGrain(cell + o), surfaceGrain(cell + o + 17.3)) - offset;
      float d = dot(site, site);
      if (d < nearest) { second = nearest; nearest = d; }
      else if (d < second) second = d;
    }
  return 1.0 - smoothstep(0.0, 0.07, sqrt(second) - sqrt(nearest));
}
vec3 oceanLit(float band) {
  vec2 world = vSurfacePosition.xz;
  float wind = uWeather.y;
  float cloud = uWeather.x;
  float swell = surfaceNoise(world * 1.7 + vec2(3.1, 7.7));
  float shore = shoreDistance(vLocal, uint(vMaterial.w + 0.5));
  float depth = smoothstep(0.0, ${float(OCEAN_DEPTH_REACH)}, shore + (swell - 0.5) * ${float(OCEAN_SWELL_SHIFT * 2)});
  vec3 water = mix(${color(PALETTE.oceanShallow)}, ${color(PALETTE.oceanMid)}, smoothstep(0.0, 0.55, depth));
  water = mix(water, ${color(PALETTE.oceanDeep)}, smoothstep(0.5, 0.9, depth));

  // A warped, wind-stretched height field gives broken wave strokes and a rippled normal.
  // Fade fine detail once it nears pixel size, so distant water does not shimmer.
  float detail = 1.0 - smoothstep(0.05, 0.18, length(fwidth(world)) * 11.0);
  vec2 wave = world * vec2(6.5, 11.0) + surfaceNoise(world * 2.3) * 0.6;
  float height = surfaceNoise(wave);
  float slopeX = surfaceNoise(wave + vec2(0.3, 0.0)) - height;
  float slopeZ = surfaceNoise(wave + vec2(0.0, 0.3)) - height;
  float roughness = (0.75 + wind * 0.9) * (0.55 + 0.45 * detail);
  vec3 normal = normalize(vec3(-slopeX * roughness, 1.0, -slopeZ * roughness * 0.7));
  float crest = smoothstep(0.92, 0.985, 1.0 - abs(2.0 * height - 1.0))
    * smoothstep(0.45, 0.72, surfaceNoise(world * 4.0 + 11.0));
  // Broad tonal patches keep open water alive after the fine detail fades out.
  float tone = surfaceNoise(world * 0.3 + 41.0);
  water *= 0.93 + 0.14 * tone;
  water = mix(water, ${color(PALETTE.oceanMid)}, 0.22 * smoothstep(0.55, 1.0, depth) * tone);
  water *= 0.97 + 0.05 * height;
  water = mix(water, mix(water, vec3(1.0), 0.3), crest * detail * (0.1 + 0.25 * wind) * (0.55 + 0.45 * depth));
  if (depth < 0.6) {
    float shallows = 1.0 - depth / 0.6;
    vec2 ripple = world * 6.0 + vec2(surfaceNoise(world * 3.0), surfaceNoise(world * 3.0 + 9.0)) * 1.6;
    water += vec3(0.06, 0.08, 0.07) * causticWeb(ripple) * shallows * shallows * detail;
  }

  // Surf laps at the shore and a broken second line marks the shelf.
  float spray = surfaceNoise(world * 26.0);
  float surf = 1.0 - smoothstep(0.015, 0.09, shore + (spray - 0.5) * 0.025);
  float shelf = (1.0 - smoothstep(0.006, 0.02, abs(shore - 0.16 - (swell - 0.5) * 0.04)))
    * smoothstep(0.5, 0.75, surfaceNoise(world * 7.0 + 5.0));
  float foam = max(surf, shelf * 0.14);
  // Keep the shelf calm under territory outlines and wires.
  water = mix(water, ${color(PALETTE.oceanShallow)}, 0.15 * (1.0 - smoothstep(0.0, 0.5, depth)));
  vec3 albedo = mix(water, vec3(0.97, 0.99, 0.98), foam * 0.85);

  vec3 lit = albedo * (uAmbient + (1.0 - uAmbient) * band);
  lit *= mix(vec3(1.0), uLightColor, 0.5);
  // Low sun keeps the shelf and surf distinct instead of sinking into one navy.
  lit = max(lit, albedo * 0.38);
  lit += ${color(PALETTE.oceanShallow)} * 0.10 * (1.0 - smoothstep(0.0, 0.5, depth)) * uNight;
  lit += vec3(0.02, 0.05, 0.08) * uNight * depth;
  // A faint sky reflection, with soft cloud shapes, sheen and sun sparkle on the ripples.
  vec3 reflected = reflect(-OCEAN_VIEW, normal);
  vec3 horizon = mix(uBackground, uLightColor, 0.45);
  vec3 zenith = mix(vec3(0.32, 0.58, 0.92) * uLightColor, uBackground, cloud * 0.6);
  vec3 sky = mix(horizon, zenith, smoothstep(0.2, 0.9, reflected.y));
  float puffs = smoothstep(0.55, 0.82, surfaceNoise(world * 0.25 + reflected.xz * 0.6));
  sky = mix(sky, uLightColor, puffs * (0.24 + 0.3 * cloud));
  float facing = 1.0 - max(dot(normal, OCEAN_VIEW), 0.0);
  float fresnel = 0.07 + 0.22 * facing * facing * facing;
  lit = mix(lit, sky, fresnel * (1.0 - foam));
  float gloss = max(dot(normal, uWaterHalfVector), 0.0);
  float sheen = pow(gloss, 18.0) * mix(0.16, 0.2, uNight);
  float sparkle = pow(gloss, 160.0) * 0.7 * detail;
  lit += uLightColor * (sheen + sparkle) * mix(1.0, 0.12, cloud) * (1.0 - foam)
    * smoothstep(0.1, 0.5, depth);
  return lit;
}
`;
