import type { MeshBuilder } from "./MeshBuilder";
import { PALETTE, rgb } from "./Palette";
import { GROUND_RADIUS } from "./Projection";
import type { RGB, Vec3 } from "./Types";

const CORNERS: readonly Vec3[] = [
  [0, 0, -GROUND_RADIUS],
  [0.5, 0, -GROUND_RADIUS / 2],
  [0.5, 0, GROUND_RADIUS / 2],
  [0, 0, GROUND_RADIUS],
  [-0.5, 0, GROUND_RADIUS / 2],
  [-0.5, 0, -GROUND_RADIUS / 2],
];
const SADDLE_ELEVATION = 0.31;
const MOUNTAIN_PROFILES = [
  { pad: 0, elevation: 0 },
  { pad: 0.26, elevation: 0.76 },
  { pad: 0.68, elevation: 0.46 },
  { pad: 0.96, elevation: 0.38 },
] as const;

const LOWER_ROCK = [rgb("#879894"), rgb("#778986"), PALETTE.rockShade] as const;
const UPPER_ROCK = [PALETTE.rock, rgb("#77858F"), rgb("#96A3AD")] as const;
const STRATA = [
  0.24, 0.39, 0.28, 0.46, 0.26, 0.32, 0.39, 0.52, 0.28, 0.47, 0.56, 0.34,
];

export function mountainProfile(footprint: number) {
  if (footprint <= 0) return 0;
  if (footprint <= MOUNTAIN_PROFILES[1].pad) return 1;
  return footprint <= MOUNTAIN_PROFILES[2].pad ? 2 : 3;
}

function perimeter(adjacentEdges: number) {
  return CORNERS.flatMap((corner, edge): Vec3[] => {
    const next = CORNERS[(edge + 1) % CORNERS.length];
    return [
      corner,
      [
        (corner[0] + next[0]) / 2,
        adjacentEdges & (1 << edge) ? SADDLE_ELEVATION : 0,
        (corner[2] + next[2]) / 2,
      ],
    ];
  });
}

function slope(
  builder: MeshBuilder,
  low: readonly Vec3[],
  high: readonly Vec3[],
  palette: readonly RGB[],
) {
  for (let i = 0; i < low.length; i++) {
    const next = (i + 1) % low.length;
    const shade = palette[(i + (i % 2)) % palette.length];
    builder.quad(low[i], high[i], high[next], low[next], shade);
  }
}

function cap(
  builder: MeshBuilder,
  ring: readonly Vec3[],
  peak: Vec3,
  palette: readonly RGB[],
) {
  for (let i = 0; i < ring.length; i++) {
    builder.triangle(
      ring[i],
      peak,
      ring[(i + 1) % ring.length],
      palette[i % palette.length],
    );
  }
}

/** The reciprocal edge saddle is shared by every profile, even across a cut terrace. */
export function buildMountainRelief(
  builder: MeshBuilder,
  profile: number,
  adjacentEdges: number,
): number {
  const { pad, elevation } = MOUNTAIN_PROFILES[profile];
  const rim = perimeter(adjacentEdges);
  if (pad) {
    const shoulderWidth = (1 + pad) / 2;
    const shoulders = rim.map(([x, y, z], i): Vec3 => [
      x * shoulderWidth,
      y + (elevation - y) * (0.5 + (i % 3) * 0.08),
      z * shoulderWidth,
    ]);
    const terrace = rim.map(([x, , z]): Vec3 => [x * pad, elevation, z * pad]);
    slope(builder, rim, shoulders, LOWER_ROCK);
    slope(builder, shoulders, terrace, UPPER_ROCK);
    cap(builder, terrace, [0, elevation, 0], [PALETTE.rockShade]);
    return elevation;
  }

  // Shift the strata as the range turns, while keeping adjacent silhouettes joined.
  const phase = adjacentEdges % STRATA.length;
  const shoulders = rim.map(([x, y, z], i): Vec3 => [
    x * 0.68,
    Math.max(y + 0.06, STRATA[(i + phase) % STRATA.length]),
    z * 0.68,
  ]);
  const ridge = rim.map(([x, , z], i): Vec3 => [
    x * 0.28 - 0.105,
    0.48 + STRATA[(i + phase) % STRATA.length] * 0.46,
    z * 0.28 - 0.16,
  ]);
  slope(builder, rim, shoulders, LOWER_ROCK);
  slope(builder, shoulders, ridge, UPPER_ROCK);
  cap(builder, ridge, [-0.105, 0.94, -0.16], UPPER_ROCK);
  return 0;
}
