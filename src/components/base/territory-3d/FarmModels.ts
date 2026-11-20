import { MeshBuilder } from "./MeshBuilder";
import { PALETTE, rgb } from "./Palette";
import type { RGB, Vec3 } from "./Types";

type Point = readonly [number, number];
type Field = readonly [Point, Point, Point, Point];
const wheat = [rgb("#D8BF78"), rgb("#C9AF70")] as const;
const pasture = [rgb("#8CAB7A"), rgb("#9BB98C")] as const;
const stubble = [rgb("#BCA98C"), rgb("#C9B799")] as const;
const orchardGreen = rgb("#71966F");
const plaster = rgb("#E4D8B7");
const roof = rgb("#A0644D");
const BARN_HALF_WIDTH = 0.065;
const BARN_HALF_DEPTH = 0.044;
const FIELD_Y = 0.0015; // Under the renderer's shadow plane, above the turf.

// Each holding has a different land-use pattern, spacing and direction.
const farms: readonly {
  plots: readonly {
    corners: Field;
    crop: readonly [RGB, RGB];
    bands: number;
  }[];
  barn?: Point;
  trees: readonly Point[];
}[] = [
  {
    // Two hay meadows and a small farmyard across the lane.
    plots: [
      {
        corners: [
          [-0.41, -0.13],
          [-0.12, -0.22],
          [-0.055, 0.06],
          [-0.34, 0.16],
        ],
        crop: wheat,
        bands: 5,
      },
      {
        corners: [
          [-0.33, 0.2],
          [-0.05, 0.1],
          [-0.025, 0.24],
          [-0.22, 0.31],
        ],
        crop: pasture,
        bands: 1,
      },
    ],
    barn: [0.06, 0.15],
    trees: [
      [0.14, 0.19],
      [0.18, 0.15],
    ],
  },
  {
    // An orchard with a narrow tilled parcel beside it.
    plots: [
      {
        corners: [
          [0.02, -0.29],
          [0.25, -0.22],
          [0.17, 0.07],
          [-0.06, 0.0],
        ],
        crop: pasture,
        bands: 1,
      },
      {
        corners: [
          [0.28, -0.19],
          [0.4, -0.15],
          [0.31, 0.14],
          [0.2, 0.1],
        ],
        crop: stubble,
        bands: 3,
      },
    ],
    trees: [
      [0.054, -0.23],
      [0.14, -0.205],
      [0.227, -0.18],
      [0.026, -0.135],
      [0.112, -0.11],
      [0.198, -0.085],
      [-0.002, -0.04],
      [0.084, -0.015],
      [0.17, 0.01],
    ],
  },
  {
    // Long strip fields following a bend in the farm lane.
    plots: [
      {
        corners: [
          [-0.32, -0.26],
          [-0.04, -0.37],
          [0.22, -0.23],
          [-0.03, -0.16],
        ],
        crop: wheat,
        bands: 3,
      },
      {
        corners: [
          [-0.27, -0.19],
          [-0.036, -0.135],
          [0.0, -0.025],
          [-0.39, -0.1],
        ],
        crop: stubble,
        bands: 1,
      },
      {
        corners: [
          [0.0, -0.14],
          [0.24, -0.21],
          [0.3, -0.11],
          [0.03, -0.03],
        ],
        crop: pasture,
        bands: 3,
      },
    ],
    trees: [
      [-0.37, -0.035],
      [-0.31, -0.022],
      [-0.26, -0.005],
    ],
  },
  {
    // A grazing farm with a small grain field beyond the house.
    plots: [
      {
        corners: [
          [0.01, 0.1],
          [0.32, 0.005],
          [0.43, 0.17],
          [0.12, 0.4],
        ],
        crop: pasture,
        bands: 1,
      },
      {
        corners: [
          [-0.37, 0.01],
          [-0.09, 0.035],
          [-0.1, 0.135],
          [-0.35, 0.15],
        ],
        crop: wheat,
        bands: 4,
      },
    ],
    barn: [-0.045, 0.22],
    trees: [
      [0.27, 0.0],
      [0.32, -0.025],
    ],
  },
];

function outsidePad(points: readonly Point[], halfWidth: number) {
  return (
    !halfWidth ||
    ([0, 1] as const).some(
      (axis) =>
        points.every((p) => p[axis] >= halfWidth) ||
        points.every((p) => p[axis] <= -halfWidth),
    )
  );
}

function field(
  builder: MeshBuilder,
  [a, b, c, d]: Field,
  colors: readonly RGB[],
  bands: number,
) {
  const along = (from: Point, to: Point, t: number): Vec3 => [
    from[0] + (to[0] - from[0]) * t,
    FIELD_Y,
    from[1] + (to[1] - from[1]) * t,
  ];
  for (let i = 0; i < bands; i++) {
    const t = i / bands,
      end = (i + 1) / bands;
    builder.quad(
      along(a, d, t),
      along(a, d, end),
      along(b, c, end),
      along(b, c, t),
      colors[i % 2],
    );
  }
}

function farmhouse(builder: MeshBuilder, x: number, z: number) {
  const w = BARN_HALF_WIDTH,
    d = BARN_HALF_DEPTH,
    wall = 0.039,
    peak = 0.066;
  builder.box([x, wall / 2, z], [w * 2, wall, d * 2], plaster);
  const left: Vec3 = [x - w, peak, z],
    right: Vec3 = [x + w, peak, z];
  const a: Vec3 = [x - w, wall, z - d],
    b: Vec3 = [x + w, wall, z - d];
  const c: Vec3 = [x + w, wall, z + d],
    e: Vec3 = [x - w, wall, z + d];
  builder
    .quad(a, left, right, b, roof)
    .quad(left, e, c, right, roof)
    .triangle(a, e, left, plaster)
    .triangle(b, right, c, plaster);
}

export function buildFarms(
  floor: MeshBuilder,
  relief: MeshBuilder,
  layout: number,
  clear: number,
) {
  const { plots, barn, trees } = farms[layout];
  for (const { corners, crop, bands } of plots)
    if (outsidePad(corners, clear)) field(floor, corners, crop, bands);
  if (barn) {
    const [x, z] = barn;
    if (
      outsidePad(
        [
          [x - BARN_HALF_WIDTH, z - BARN_HALF_DEPTH],
          [x + BARN_HALF_WIDTH, z + BARN_HALF_DEPTH],
        ],
        clear,
      )
    )
      farmhouse(relief, x, z);
  }
  for (const [x, z] of trees) {
    const radius = 0.029;
    if (
      !outsidePad(
        [
          [x - radius, z - radius],
          [x + radius, z + radius],
        ],
        clear,
      )
    )
      continue;
    relief
      .cylinder([x, 0, z], 0.006, 0.006, 0.027, PALETTE.timber, 4)
      .cylinder([x, 0.018, z], radius * 0.64, radius, 0.021, orchardGreen, 5)
      .cylinder([x, 0.039, z], radius, 0, 0.031, orchardGreen, 5);
  }
}
