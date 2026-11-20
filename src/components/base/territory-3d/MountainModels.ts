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
  { pad: 0.26, elevation: 0.64 },
  { pad: 0.68, elevation: 0.46 },
  { pad: 0.96, elevation: 0.38 },
] as const;

const LOWER_ROCK = [rgb("#879894"), rgb("#778986"), PALETTE.rockShade] as const;
const UPPER_ROCK = [PALETTE.rock, rgb("#77858F"), rgb("#96A3AD")] as const;
const STRATA = [
  0.36, 0.57, 0.43, 0.64, 0.49, 0.32, 0.55, 0.4, 0.61, 0.44, 0.3, 0.53,
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

// The flanks meet along a broken crest. Its five stations run from one spur,
// over two unequal summits and their intervening col, to the opposite spur.
const CRESTS: readonly (readonly Vec3[])[] = [
  [
    [-0.34, 0.29, -0.02],
    [-0.19, 0.48, 0.04],
    [-0.035, 0.39, -0.015],
    [0.1, 0.65, -0.045],
    [0.3, 0.34, 0.025],
  ],
  [
    [-0.33, 0.38, 0.015],
    [-0.12, 0.58, -0.025],
    [0.035, 0.47, 0.025],
    [0.21, 0.5, 0.055],
    [0.36, 0.25, 0.02],
  ],
  [
    [-0.34, 0.24, 0.035],
    [-0.17, 0.43, -0.015],
    [-0.015, 0.37, 0.04],
    [0.13, 0.53, 0.017],
    [0.31, 0.46, -0.035],
  ],
  [
    [-0.35, 0.33, -0.01],
    [-0.14, 0.74, 0.035],
    [0.025, 0.49, 0.0],
    [0.17, 0.55, -0.05],
    [0.35, 0.29, -0.015],
  ],
];
const CREST_AT_RIM = [2, 3, 4, 4, 4, 3, 2, 1, 0, 0, 0, 1];

/** Turn the crest toward adjoining saddles. A tile's artwork breaks ties. */
function ridgeTurn(edges: number, variant: number) {
  let best = variant % 3,
    score = -1;
  for (let i = 0; i < 3; i++) {
    const turn = (variant + i) % 3;
    const end = (turn + 1) % 6;
    const connected = ((edges >> end) & 1) + ((edges >> ((end + 3) % 6)) & 1);
    if (connected > score) {
      best = turn;
      score = connected;
    }
  }
  return best;
}

/** The reciprocal edge saddle is shared by every profile, even across a cut terrace. */
export function buildMountainRelief(
  builder: MeshBuilder,
  profile: number,
  adjacentEdges: number,
  variant: number,
): number {
  const { pad, elevation } = MOUNTAIN_PROFILES[profile];
  const rim = perimeter(adjacentEdges);
  if (pad) {
    const shoulders = rim.map(([x, y, z], i): Vec3 => {
      const rib = STRATA[(i + adjacentEdges) % STRATA.length];
      const width = pad + (1 - pad) * rib;
      return [x * width, y + (elevation - y) * (0.85 - rib), z * width];
    });
    const terrace = rim.map(([x, , z]): Vec3 => [x * pad, elevation, z * pad]);
    slope(builder, rim, shoulders, LOWER_ROCK);
    slope(builder, shoulders, terrace, UPPER_ROCK);
    cap(builder, terrace, [0, elevation, 0], [PALETTE.rockShade]);
    return elevation;
  }

  const turn = ridgeTurn(adjacentEdges, variant);
  const angle = (turn * Math.PI) / 3;
  const crest = CRESTS[variant].map(([x, y, z]): Vec3 => [
    x * Math.cos(angle) - z * Math.sin(angle),
    y,
    x * Math.sin(angle) + z * Math.cos(angle),
  ]);
  const foot = rim.map((_, i) => rim[(i + turn * 2) % rim.length]);
  const shoulders = foot.map(([x, y, z], i): Vec3 => {
    const summit = crest[CREST_AT_RIM[i]];
    const spur = STRATA[(i + variant * 3) % STRATA.length];
    return [
      x + (summit[0] - x) * 0.44,
      y + (summit[1] - y) * spur,
      z + (summit[2] - z) * 0.44,
    ];
  });
  // The broad apron gives way to steeper rock ribs and shaded gullies.
  for (let i = 0; i < foot.length; i++) {
    const next = (i + 1) % foot.length;
    const a = crest[CREST_AT_RIM[i]],
      b = crest[CREST_AT_RIM[next]];
    builder.quad(
      foot[i],
      shoulders[i],
      shoulders[next],
      foot[next],
      LOWER_ROCK[0],
    );
    builder.triangle(shoulders[i], a, shoulders[next], UPPER_ROCK[0]);
    if (a !== b) builder.triangle(a, b, shoulders[next], UPPER_ROCK[2]);
  }
  return 0;
}
