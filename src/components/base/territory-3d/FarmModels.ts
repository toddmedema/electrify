import { MeshBuilder } from "./MeshBuilder";
import { PALETTE, rgb } from "./Palette";
import type { RGB, Vec3 } from "./Types";

type Point = readonly [x: number, z: number];
type Parcel = readonly [
  west: number,
  north: number,
  east: number,
  south: number,
];
type Crop = "grain" | "stubble" | "pasture" | "orchard";
interface Farm {
  fields: readonly { bounds: Parcel; crop: Crop }[];
  barn?: Point;
  trees: readonly Point[];
}

const crops = {
  grain: [rgb("#D2BB76"), rgb("#CAB370")],
  stubble: [rgb("#BDA886"), rgb("#B5A080")],
  pasture: rgb("#92B280"),
  orchard: rgb("#9CAF7C"),
} as const;
const orchardGreen = rgb("#688A61");
const plaster = rgb("#E4D8B7");
const roof = rgb("#A0644D");
const gravel = rgb("#C2B89D");
const FIELD_Y = 0.0015; // Above the turf and below projected shadows.
const BARN_HALF_WIDTH = 0.056;
const BARN_HALF_DEPTH = 0.035;
const TREE_RADIUS = 0.028;

// Adjacent US parcels often share a survey bearing. All four holdings use
// the same ground-plane axes; the map camera supplies the foreshortening.
const BEARING = Math.PI / 12;
const COS = Math.cos(BEARING);
const SIN = Math.sin(BEARING);
const farmPoint = (x: number, y: number, z: number): Vec3 => [
  x * COS - z * SIN,
  y,
  x * SIN + z * COS,
];

const farms: readonly Farm[] = [
  {
    // A mown hay meadow and an adjoining pasture with a farmyard at the lane.
    fields: [
      { bounds: [-0.41, -0.21, -0.13, 0.17], crop: "grain" },
      { bounds: [-0.115, -0.21, 0.15, 0.035], crop: "pasture" },
    ],
    barn: [-0.046, 0.105],
    trees: [
      [0.069, 0.115],
      [0.129, 0.132],
    ],
  },
  {
    // An orchard block across a grass lane from a harvested field.
    fields: [
      { bounds: [0.16, -0.245, 0.43, 0.07], crop: "orchard" },
      { bounds: [-0.075, -0.245, 0.142, -0.015], crop: "stubble" },
    ],
    trees: [],
  },
  {
    // Three long row-crop parcels share a headland along their east ends.
    fields: [
      { bounds: [-0.23, -0.36, 0.245, -0.252], crop: "pasture" },
      { bounds: [-0.3, -0.239, 0.245, -0.133], crop: "grain" },
      { bounds: [-0.3, -0.12, 0.05, -0.028], crop: "stubble" },
    ],
    trees: [
      [0.286, -0.224],
      [0.284, -0.149],
      [0.287, -0.079],
    ],
  },
  {
    // A grazing farm with two paddocks and a hayfield south of the barn.
    fields: [
      { bounds: [0.005, 0.035, 0.35, 0.222], crop: "pasture" },
      { bounds: [0.005, 0.238, 0.2, 0.362], crop: "pasture" },
      { bounds: [-0.245, 0.154, -0.012, 0.362], crop: "grain" },
    ],
    barn: [-0.086, 0.087],
    trees: [
      [-0.203, 0.093],
      [-0.246, 0.048],
    ],
  },
];

function clearsPad([west, north, east, south]: Parcel, halfWidth: number) {
  if (!halfWidth) return true;
  const [x, , z] = farmPoint((west + east) / 2, 0, (north + south) / 2);
  const w = (east - west) / 2,
    d = (south - north) / 2;
  return (
    Math.abs(x) - (COS * w + SIN * d) >= halfWidth ||
    Math.abs(z) - (SIN * w + COS * d) >= halfWidth
  );
}

function groundRect(
  builder: MeshBuilder,
  west: number,
  north: number,
  east: number,
  south: number,
  color: RGB,
) {
  builder.quad(
    farmPoint(west, FIELD_Y, north),
    farmPoint(west, FIELD_Y, south),
    farmPoint(east, FIELD_Y, south),
    farmPoint(east, FIELD_Y, north),
    color,
  );
}

function tree(builder: MeshBuilder, x: number, z: number) {
  const [tx, , tz] = farmPoint(x, 0, z);
  builder
    .cylinder([tx, 0, tz], 0.006, 0.006, 0.02, PALETTE.timber, 4)
    .cylinder(
      [tx, 0.014, tz],
      TREE_RADIUS * 0.67,
      TREE_RADIUS,
      0.023,
      orchardGreen,
      5,
    )
    .cylinder(
      [tx, 0.037, tz],
      TREE_RADIUS,
      TREE_RADIUS * 0.45,
      0.02,
      orchardGreen,
      5,
    );
}

function field(
  floor: MeshBuilder,
  relief: MeshBuilder,
  bounds: Parcel,
  crop: Crop,
) {
  const [west, north, east, south] = bounds;
  const width = east - west,
    depth = south - north;
  if (crop === "orchard" || crop === "pasture") {
    groundRect(floor, ...bounds, crops[crop]);
    if (crop === "orchard") {
      for (let row = 0; row < 4; row++)
        for (let column = 0; column < 3; column++)
          tree(
            relief,
            west + (width * (column + 0.5)) / 3,
            north + (depth * (row + 0.5)) / 4,
          );
    }
    return;
  }
  // Harvest swaths run the long way down each field, ending at a headland.
  const colors = crops[crop];
  const alongX = width > depth;
  const count = Math.max(3, Math.round(Math.min(width, depth) / 0.038));
  const headland = 0.018;
  if (alongX) groundRect(floor, west, north, west + headland, south, colors[0]);
  else groundRect(floor, west, north, east, north + headland, colors[0]);
  for (let i = 0; i < count; i++) {
    const start = i / count,
      end = (i + 1) / count;
    if (alongX)
      groundRect(
        floor,
        west + headland,
        north + depth * start,
        east,
        north + depth * end,
        colors[i % 2],
      );
    else
      groundRect(
        floor,
        west + width * start,
        north + headland,
        west + width * end,
        south,
        colors[i % 2],
      );
  }
}

function farmhouse(builder: MeshBuilder, x: number, z: number) {
  const w = BARN_HALF_WIDTH,
    d = BARN_HALF_DEPTH,
    wall = 0.036,
    peak = 0.061;
  builder.box(farmPoint(x, wall / 2, z), [w * 2, wall, d * 2], plaster, [
    0,
    -BEARING,
    0,
  ]);
  const left = farmPoint(x - w, peak, z),
    right = farmPoint(x + w, peak, z);
  const a = farmPoint(x - w, wall, z - d),
    b = farmPoint(x + w, wall, z - d);
  const c = farmPoint(x + w, wall, z + d),
    e = farmPoint(x - w, wall, z + d);
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
  const { fields, barn, trees } = farms[layout];
  const remaining = fields.filter(({ bounds }) => clearsPad(bounds, clear));
  if (!remaining.length) return;
  for (const { bounds, crop } of remaining) field(floor, relief, bounds, crop);
  if (barn) {
    const [x, z] = barn;
    const yard: Parcel = [x - 0.069, z - 0.048, x + 0.079, z + 0.048];
    if (clearsPad(yard, clear)) {
      groundRect(floor, ...yard, gravel);
      farmhouse(relief, x, z);
    }
  }
  for (const [x, z] of trees)
    if (
      clearsPad(
        [x - TREE_RADIUS, z - TREE_RADIUS, x + TREE_RADIUS, z + TREE_RADIUS],
        clear,
      )
    )
      tree(relief, x, z);
}
