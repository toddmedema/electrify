import { tintTerrainMesh } from "./TerrainWeatherMaterials";
import type { TerrainType } from "../../../Types";
import { buildFarms } from "./FarmModels";
import { getForestModel } from "./ForestModels";
import { MeshBuilder } from "./MeshBuilder";
import { buildMountainRelief, mountainProfile } from "./MountainModels";
import { PALETTE } from "./Palette";
import { GROUND_HEX_CORNERS as HEX, GROUND_RADIUS } from "./Projection";
import type {
  MapMesh,
  MapModel,
  ModelPart,
  RGB,
  TerrainModelOptions,
  Vec3,
} from "./Types";
import { WATERSHED_BANK_DEPTH } from "./WaterSurface";

type GroundPoint = readonly [number, number];
type RaisedPoint = readonly [number, number, number];

const CLEAR_WIDTHS = [0.55, 0.65, 0.8, 1.2] as const;
const FARM_CLEAR_WIDTHS = [0, 0.26, ...CLEAR_WIDTHS];
const DEPTH = 0.055;
const RIVER_PORT_HALF_WIDTH = 0.145;
const RIVER_BANK_INSET = 0.13;
const OPPOSITE_RIVER_PORTS = [0b001001, 0b010010, 0b100100];
const cache: Record<
  Exclude<TerrainType, "forest">,
  (MapModel | undefined)[]
> = {
  plains: [],
  hills: [],
  mountain: [],
  river: [],
  lake: [],
  ocean: [],
};

let mountainFloor: MapMesh | undefined;

const point = ([x, z]: GroundPoint, y = 0): Vec3 => [x, y, z];
const lerp = (a: GroundPoint, b: GroundPoint, t: number): GroundPoint => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];
const scaled = (p: GroundPoint, scale: number): GroundPoint => [
  p[0] * scale,
  p[1] * scale,
];

/** Give each convex ground/relief face an upward flat normal, regardless of its perimeter order. */
function surface(builder: MeshBuilder, polygon: readonly Vec3[], color: RGB) {
  for (let i = 1; i < polygon.length - 1; i++) {
    const a = polygon[0],
      b = polygon[i],
      c = polygon[i + 1];
    const area = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
    if (Math.abs(area) < 1e-12) continue;
    builder.triangle(a, area > 0 ? c : b, area > 0 ? b : c, color);
  }
}

function substrate(builder: MeshBuilder, water: boolean, riverPorts: number) {
  const side = water ? PALETTE.deepWater : PALETTE.earthShade;
  for (let i = 0; i < 6; i++) {
    const a = HEX[i],
      b = HEX[(i + 1) % 6];
    const edge = [point(a)];
    if (riverPorts & (1 << i)) {
      const [left, right] = riverPort(a, b);
      const [bedLeft, bedRight] = riverBed(left, right);
      // The same shelf profile cuts the tile wall below the waterline.
      const [leftRim, leftShelf, leftBed] = riverShelfProfile(left, bedLeft);
      const [rightRim, rightShelf, rightBed] = riverShelfProfile(
        right,
        bedRight,
      );
      edge.push(leftRim, leftShelf, leftBed, rightBed, rightShelf, rightRim);
    }
    edge.push(point(b));
    for (let j = 1; j < edge.length; j++) {
      const start = edge[j - 1];
      const end = edge[j];
      builder.quad(
        start,
        end,
        [end[0], -DEPTH, end[2]],
        [start[0], -DEPTH, start[2]],
        side,
      );
    }
    builder.triangle([0, -DEPTH, 0], point(a, -DEPTH), point(b, -DEPTH), side);
  }
}

function ground(builder: MeshBuilder, color: RGB) {
  surface(
    builder,
    HEX.map((p) => point(p)),
    color,
  );
}

/** Clip a convex raised face and grade its cut edge down to the level building pad. */
function clip(
  polygon: readonly RaisedPoint[],
  axis: 0 | 2,
  boundary: number,
  sign: number,
  keepOutside: boolean,
): RaisedPoint[] {
  const output: RaisedPoint[] = [];
  const distance = (p: RaisedPoint) => (p[axis] - boundary) * sign;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length];
    const da = distance(a),
      db = distance(b);
    const insideA = keepOutside ? da >= 0 : da <= 0;
    const insideB = keepOutside ? db >= 0 : db <= 0;
    if (insideA) output.push(a);
    if (insideA !== insideB) {
      const t = da / (da - db);
      output.push([a[0] + (b[0] - a[0]) * t, 0, a[2] + (b[2] - a[2]) * t]);
    }
  }
  return output;
}

function raisedFace(
  builder: MeshBuilder,
  polygon: readonly RaisedPoint[],
  clear: number,
  color: RGB,
) {
  if (!polygon.some((p) => p[1] > 0)) return;
  // Disjoint exterior regions avoid both overlapping relief and triangles spanning the pad.
  let remaining = polygon;
  for (const [axis, sign] of [
    [0, -1],
    [0, 1],
    [2, -1],
    [2, 1],
  ] as const) {
    const exterior = clip(remaining, axis, sign * clear, sign, true);
    if (exterior.some((p) => p[1] > 0)) surface(builder, exterior, color);
    remaining = clip(remaining, axis, sign * clear, sign, false);
  }
}

function mound(
  builder: MeshBuilder,
  base: readonly GroundPoint[],
  summit: Vec3,
  clear: number,
  color: RGB,
  shade: RGB,
) {
  for (let i = 0; i < base.length; i++)
    raisedFace(
      builder,
      [point(base[i]), point(base[(i + 1) % base.length]), summit],
      clear,
      i % 3 === 1 ? shade : color,
    );
}

function bank(
  builder: MeshBuilder,
  a: GroundPoint,
  b: GroundPoint,
  outward: GroundPoint,
  clear: number,
) {
  const length = Math.hypot(...outward) || 1;
  const offset = scaled(outward, 0.027 / length);
  const outer = (p: GroundPoint): GroundPoint => [
    p[0] + offset[0],
    p[1] + offset[1],
  ];
  const ridge = (p: GroundPoint): Vec3 => [
    p[0] + offset[0] * 0.55,
    0.027,
    p[1] + offset[1] * 0.55,
  ];
  raisedFace(
    builder,
    [point(a), point(b), ridge(b), ridge(a)],
    clear,
    PALETTE.earth,
  );
  raisedFace(
    builder,
    [ridge(a), ridge(b), point(outer(b)), point(outer(a))],
    clear,
    PALETTE.grassShade,
  );
}

/** A shallow submerged shelf exposes shoreline as the surface drops. */
function waterBank(
  floor: MeshBuilder,
  a: GroundPoint,
  b: GroundPoint,
  lowA: GroundPoint,
  lowB: GroundPoint,
) {
  surface(
    floor,
    [
      point(a),
      point(b),
      point(lowB, WATERSHED_BANK_DEPTH),
      point(lowA, WATERSHED_BANK_DEPTH),
    ],
    PALETTE.earthShade,
  );
}

function riverShelfProfile(rim: GroundPoint, bed: GroundPoint) {
  return [
    point(rim),
    point(lerp(rim, bed, 0.68), -0.018),
    point(bed, WATERSHED_BANK_DEPTH),
  ] as const;
}

function riverShelf(
  floor: MeshBuilder,
  a: GroundPoint,
  b: GroundPoint,
  lowA: GroundPoint,
  lowB: GroundPoint,
) {
  const [rimA, shallowA, bedA] = riverShelfProfile(a, lowA);
  const [rimB, shallowB, bedB] = riverShelfProfile(b, lowB);
  surface(floor, [rimA, rimB, shallowB, shallowA], PALETTE.riverShelf);
  surface(floor, [shallowA, shallowB, bedB, bedA], PALETTE.riverShallows);
}

type RiverSection = readonly [
  leftLand: GroundPoint,
  leftBank: GroundPoint,
  rightBank: GroundPoint,
  rightLand: GroundPoint,
  dryWaterRise?: number,
];

function riverPort(a: GroundPoint, b: GroundPoint): [GroundPoint, GroundPoint] {
  const half = RIVER_PORT_HALF_WIDTH / GROUND_RADIUS;
  return [lerp(a, b, 0.5 - half), lerp(a, b, 0.5 + half)];
}

function riverBed(a: GroundPoint, b: GroundPoint): [GroundPoint, GroundPoint] {
  return [lerp(a, b, RIVER_BANK_INSET), lerp(b, a, RIVER_BANK_INSET)];
}

function riverStrip(
  floor: MeshBuilder,
  water: MeshBuilder,
  from: RiverSection,
  to: RiverSection,
  toBed?: readonly [GroundPoint, GroundPoint],
) {
  const [landA, a, b, landB, riseA] = from;
  const [landC, c, d, landD, riseB] = to;
  surface(
    floor,
    [landA, landC, c, a].map((p) => point(p)),
    PALETTE.grass,
  );
  surface(
    floor,
    [b, d, landD, landB].map((p) => point(p)),
    PALETTE.grass,
  );
  surface(
    water,
    [point(a, riseA), point(c, riseB), point(d, riseB), point(b, riseA)],
    PALETTE.riverWater,
  );
  if (a !== b || c !== d) {
    const [bedA, bedB] = riverBed(a, b);
    const [bedC, bedD] = toBed ?? riverBed(c, d);
    riverShelf(floor, a, c, bedA, bedC);
    riverShelf(floor, d, b, bedD, bedB);
  }
}

type ChannelProfile = readonly [
  distance: number,
  center: number,
  halfWidth: number,
];

function riverAxis(axis: number) {
  const [ax, az] = HEX[axis];
  const [bx, bz] = HEX[(axis + 1) % 6];
  const normalX = ax + bx;
  const normalZ = az + bz;
  return (x: number, z: number): GroundPoint => [
    x * normalX - z * normalZ,
    x * normalZ + z * normalX,
  ];
}

function channelSection(
  along: ReturnType<typeof riverAxis>,
  x: number,
  center: number,
  halfWidth: number,
  leftLand: number,
  rightLand: number,
  dryWaterRise?: number,
): RiverSection {
  const leftBank = along(x, center - halfWidth);
  return [
    along(x, leftLand),
    leftBank,
    halfWidth ? along(x, center + halfWidth) : leftBank,
    along(x, rightLand),
    dryWaterRise,
  ];
}

function riverAlongAxis(
  floor: MeshBuilder,
  water: MeshBuilder,
  along: ReturnType<typeof riverAxis>,
  profile: readonly ChannelProfile[],
  dryWaterRiseAt?: (x: number) => number,
) {
  let previous: RiverSection | undefined;
  for (const [x, center, halfWidth] of profile) {
    const land = GROUND_RADIUS * (1 - Math.abs(x));
    const section = channelSection(
      along,
      x,
      center,
      halfWidth,
      -land,
      land,
      dryWaterRiseAt?.(x),
    );
    if (previous) riverStrip(floor, water, previous, section);
    previous = section;
  }
}

type FeederProfile = readonly [
  distance: number,
  ...channels: (readonly [center: number, halfWidth: number])[],
];

/** Narrow feeder water remains visible at low runoff and grades down before the tile edge. */
function headwaterRise(x: number) {
  const t = Math.min(1, Math.max(0, (x - 0.14) / 0.31));
  return 0.04 * (1 - t * t * (3 - 2 * t));
}

function feederReach(
  floor: MeshBuilder,
  water: MeshBuilder,
  along: ReturnType<typeof riverAxis>,
  profile: readonly FeederProfile[],
  joiningBank: number,
) {
  let previous: RiverSection[] = [];
  for (const [row, [x, ...branches]] of profile.entries()) {
    const land = GROUND_RADIUS * (1 - Math.abs(x));
    const sections = branches.map(([center, width], index) => {
      const left = branches[index - 1];
      const right = branches[index + 1];
      return channelSection(
        along,
        x,
        center,
        width,
        left ? (left[0] + left[1] + center - width) / 2 : -land,
        right ? (right[0] - right[1] + center + width) / 2 : land,
        headwaterRise(x),
      );
    });
    previous.forEach((from, index) => {
      const to = sections[index];
      const bed = riverBed(to[1], to[2]);
      if (row === profile.length - 1) {
        // Both inner shelves taper away where the feeder joins the channel.
        if (index === joiningBank) bed[1] = to[2];
        if (index === joiningBank + 1) bed[0] = to[1];
      }
      riverStrip(floor, water, from, to, bed);
    });
    previous = sections;
  }
}

function headwaters(
  floor: MeshBuilder,
  water: MeshBuilder,
  axis: number,
  variant: number,
) {
  const rotate = riverAxis(axis);
  const along = (x: number, z: number) => rotate(x, variant ? -z : z);
  // Irregular source lengths and two staggered confluences give the main
  // stream a continuous course between the smaller, rounded feeder streams.
  feederReach(
    floor,
    water,
    along,
    [
      [-0.5, [-0.205, 0], [-0.041, 0], [0.243, 0]],
      [-0.465, [-0.205, 0], [-0.04, 0], [0.243, 0]],
      [-0.446, [-0.205, 0], [-0.037, 0.014], [0.243, 0]],
      [-0.408, [-0.226, 0], [-0.025, 0.023], [0.25, 0]],
      [-0.392, [-0.228, 0.01], [-0.014, 0.025], [0.255, 0]],
      [-0.372, [-0.224, 0.018], [0.007, 0.03], [0.26, 0]],
      [-0.328, [-0.195, 0.028], [0.04, 0.036], [0.275, 0]],
      [-0.31, [-0.18, 0.027], [0.049, 0.04], [0.276, 0.014]],
      [-0.278, [-0.174, 0.025], [0.057, 0.046], [0.274, 0.022]],
      [-0.236, [-0.185, 0.025], [0.045, 0.053], [0.252, 0.024]],
      [-0.191, [-0.191, 0.029], [0.021, 0.058], [0.217, 0.023]],
      [-0.147, [-0.176, 0.034], [-0.011, 0.063], [0.199, 0.026]],
      [-0.105, [-0.149, 0.035], [-0.028, 0.067], [0.203, 0.028]],
      [-0.07, [-0.12, 0.03], [-0.02, 0.07], [0.217, 0.025]],
    ],
    0,
  );
  feederReach(
    floor,
    water,
    along,
    [
      [-0.07, [-0.05, 0.1], [0.217, 0.025]],
      [-0.025, [-0.029, 0.101], [0.233, 0.025]],
      [0, [-0.017, 0.104], [0.235, 0.025]],
      [0.02, [-0.008, 0.106], [0.233, 0.025]],
      [0.06, [0.008, 0.107], [0.207, 0.027]],
      [0.09, [0.003, 0.106], [0.174, 0.028]],
      [0.121, [-0.014, 0.103], [0.136, 0.032]],
      [0.16, [-0.025, 0.1], [0.11, 0.035]],
    ],
    0,
  );
  riverAlongAxis(
    floor,
    water,
    along,
    [
      [0.16, 0.01, 0.135],
      [0.22, -0.012, 0.138],
      [0.3, -0.037, 0.147],
      [0.38, -0.026, 0.149],
      [0.45, -0.008, 0.147],
      [0.5, 0, RIVER_PORT_HALF_WIDTH],
    ],
    headwaterRise,
  );
}

/** The widest bends sit inside the hex. Both banks straighten as they meet
 * neighboring tiles, so variation never changes a shared crossing. */
function throughRiver(
  floor: MeshBuilder,
  water: MeshBuilder,
  axis: number,
  variant: number,
) {
  const [bend, skew, spread] = [
    [-0.18, 0.11, 0.043],
    [0.135, 0.12, 0.016],
    [0.19, -0.1, 0.035],
    [-0.11, -0.13, 0.024],
  ][variant];
  const profile = Array.from({ length: 9 }, (_, step): ChannelProfile => {
    const x = step / 8 - 0.5;
    const envelope = (1 - 4 * x * x) * (1 - 4 * x * x);
    return [
      x,
      envelope * (bend + skew * 3 * x),
      RIVER_PORT_HALF_WIDTH + envelope * spread,
    ];
  });
  riverAlongAxis(floor, water, riverAxis(axis), profile);
}

function edgeFraction(p: GroundPoint, a: GroundPoint, b: GroundPoint) {
  const x = b[0] - a[0];
  const z = b[1] - a[1];
  return ((p[0] - a[0]) * x + (p[1] - a[1]) * z) / (x * x + z * z);
}

const isHeadwater = (ports: number) =>
  ports !== 0 && (ports & (ports - 1)) === 0;

function river(
  floor: MeshBuilder,
  water: MeshBuilder,
  ports: number,
  variant: number,
) {
  const axis = OPPOSITE_RIVER_PORTS.indexOf(ports);
  if (axis !== -1) {
    throughRiver(floor, water, axis, variant);
    return;
  }

  if (isHeadwater(ports)) {
    headwaters(floor, water, Math.log2(ports), variant);
    return;
  }
  const exits = HEX.flatMap((a, edge) =>
    ports & (1 << edge) ? [lerp(a, HEX[(edge + 1) % 6], 0.5)] : [],
  );

  // Move the join toward the exits of a bend. Junctions keep a compact shared basin.
  const center =
    exits.length === 2
      ? scaled(lerp(exits[0], exits[1], 0.5), 0.42)
      : ([0, 0] as const);
  const radius = exits.length ? 0.35 : 0.2;
  const inner = HEX.map(([x, z]): GroundPoint => [
    x * radius + center[0],
    z * radius + center[1],
  ]);
  riverBasin(floor, water, ports, inner, center);
}

function riverBasin(
  floor: MeshBuilder,
  water: MeshBuilder,
  ports: number,
  inner: readonly GroundPoint[],
  center: GroundPoint,
) {
  const bed = (p: GroundPoint) => lerp(center, p, 0.8);
  surface(
    water,
    inner.map((p) => point(p)),
    PALETTE.riverWater,
  );
  for (let i = 0; i < 6; i++) {
    const a = HEX[i],
      b = HEX[(i + 1) % 6],
      ia = inner[i],
      ib = inner[(i + 1) % 6];
    if (ports & (1 << i)) {
      const [wa, wb] = riverPort(a, b);
      const iwa = lerp(ia, ib, 0.06);
      const iwb = lerp(ia, ib, 0.94);
      // Ease the arm into the bend while keeping the same approach at the seam.
      let previous: RiverSection = [a, wa, wb, b];
      for (const [distance, taper] of [
        [0.32, 0.13],
        [0.67, 0.53],
      ]) {
        const landA = lerp(a, ia, distance);
        const landB = lerp(b, ib, distance);
        const midWa = lerp(wa, iwa, taper);
        const midWb = lerp(wb, iwb, taper);
        const section: RiverSection = [
          landA,
          lerp(landA, landB, edgeFraction(midWa, landA, landB)),
          lerp(landA, landB, edgeFraction(midWb, landA, landB)),
          landB,
        ];
        riverStrip(floor, water, previous, section);
        previous = section;
      }
      riverStrip(floor, water, previous, [ia, iwa, iwb, ib]);
      const [iwaBed, iwbBed] = riverBed(iwa, iwb);
      riverShelf(floor, ia, iwa, bed(ia), bed(iwa));
      riverShelf(floor, iwb, ib, bed(iwb), bed(ib));
      riverShelf(floor, iwa, iwa, bed(iwa), iwaBed);
      riverShelf(floor, iwb, iwb, bed(iwb), iwbBed);
    } else {
      surface(floor, [point(ia), point(a), point(b), point(ib)], PALETTE.grass);
      riverShelf(floor, ia, ib, bed(ia), bed(ib));
    }
  }
}

function lake(
  floor: MeshBuilder,
  relief: MeshBuilder,
  water: MeshBuilder,
  clear: number,
  riverPorts: number,
) {
  const shore = HEX.map((p, index) =>
    scaled(p, [0.73, 0.76, 0.69, 0.75, 0.7, 0.74][index]),
  );
  if (riverPorts) {
    riverBasin(floor, water, riverPorts, shore, [0, 0]);
    return;
  }
  surface(
    water,
    shore.map((p) => point(p)),
    PALETTE.water,
  );
  for (let i = 0; i < 6; i++) {
    const a = shore[i],
      b = shore[(i + 1) % 6];
    surface(
      floor,
      [point(a), point(HEX[i]), point(HEX[(i + 1) % 6]), point(b)],
      PALETTE.grass,
    );
    waterBank(floor, a, b, scaled(a, 0.76), scaled(b, 0.76));
    bank(relief, a, b, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], clear);
  }
}

function build(
  terrain: Exclude<TerrainType, "forest">,
  bucket: number,
  mask: number,
  variant = 0,
): MapModel {
  const clear =
    (terrain === "plains" ? FARM_CLEAR_WIDTHS : CLEAR_WIDTHS)[bucket] / 2;
  const floor = new MeshBuilder();
  const relief = new MeshBuilder();
  const water = new MeshBuilder();
  let supportY: number | undefined;
  const sharedFloor = terrain === "mountain" ? mountainFloor : undefined;
  if (!sharedFloor)
    substrate(
      floor,
      terrain === "ocean",
      terrain === "river" || terrain === "lake" ? mask : 0,
    );
  switch (terrain) {
    case "river":
      river(floor, water, mask, variant);
      break;
    case "lake":
      lake(floor, relief, water, clear, mask);
      break;
    case "ocean":
      ground(water, PALETTE.water);
      break;
    case "mountain":
      if (!sharedFloor) ground(floor, PALETTE.rock);
      supportY = buildMountainRelief(relief, bucket, mask, variant);
      break;
    case "hills":
      ground(floor, PALETTE.grass);
      mound(
        relief,
        [
          [-0.28, -0.32],
          [-0.14, -0.49],
          [0.02, -0.54],
          [0.25, -0.31],
          [0.1, -0.22],
        ],
        [-0.025, 0.13, -0.44],
        clear,
        PALETTE.grass,
        PALETTE.grassShade,
      );
      mound(
        relief,
        [
          [0.27, -0.2],
          [0.48, -0.18],
          [0.48, 0.19],
          [0.25, 0.27],
        ],
        [0.395, 0.105, 0.065],
        clear,
        PALETTE.grass,
        PALETTE.grassShade,
      );
      break;
    case "plains":
      ground(floor, PALETTE.grass);
      buildFarms(floor, relief, variant, clear);
      break;
  }
  const raised = relief.build();
  const surfaceWater = water.build();
  const waterPart: ModelPart = {
    mesh: surfaceWater,
    material:
      terrain === "ocean"
        ? "water"
        : terrain === "river" || (terrain === "lake" && mask !== 0)
          ? "river-water"
          : "watershed-water",
    castsShadow: false,
    receivesShadow: true,
  };
  let height = 0;
  for (let i = 1; i < raised.positions.length; i += 3)
    height = Math.max(height, raised.positions[i]);
  const floorMesh = sharedFloor ?? floor.build();
  if (terrain === "mountain") mountainFloor = floorMesh;
  return {
    key: `terrain:${terrain}:${bucket}:${mask}${variant ? `:${variant}` : ""}`,
    parts: [
      { mesh: floorMesh, castsShadow: false, receivesShadow: true },
      ...(raised.positions.length
        ? [
            {
              mesh: raised,
              ...(terrain === "mountain"
                ? { material: "mountain" as const }
                : {}),
              castsShadow: true,
              receivesShadow: false,
            },
          ]
        : []),
      ...(surfaceWater.positions.length ? [waterPart] : []),
    ],
    terminals: [],
    footprint: 1,
    height,
    ...(supportY !== undefined && { supportY }),
  };
}

const scarredModels = new WeakMap<MapModel, MapModel>();

function scorchedRelief(model: MapModel): MapModel {
  const cached = scarredModels.get(model);
  if (cached) return cached;
  const scarred = {
    ...model,
    key: `${model.key}:scorched`,
    parts: model.parts.map((part) => ({
      ...part,
      mesh: tintTerrainMesh(part.mesh, "ash"),
    })),
  };
  scarredModels.set(model, scarred);
  return scarred;
}

/** Discrete clearing profiles and six edge bits bound the number of shared meshes. */
export function getTerrainModel(
  terrain: TerrainType,
  options?: TerrainModelOptions,
): MapModel {
  if (terrain === "forest")
    return getForestModel(options, () => {
      const floor = new MeshBuilder();
      substrate(floor, false, 0);
      ground(floor, PALETTE.grassShade);
      return floor.build();
    });
  const requested = options?.footprint ?? 0;
  const scorched =
    options?.weather === "burning" || options?.weather === "scorched";
  const variant = (options?.variant ?? 0) & 3;
  if (terrain === "mountain") {
    const profile = mountainProfile(requested);
    const edges = (options?.adjacentEdges ?? 0) & 63;
    const crest = profile ? 0 : variant;
    const model = (cache.mountain[(crest * 4 + profile) * 64 + edges] ??= build(
      "mountain",
      profile,
      edges,
      crest,
    ));
    return scorched ? scorchedRelief(model) : model;
  }
  const bucket =
    requested > 0.8 ? 3 : requested > 0.65 ? 2 : requested > 0.55 ? 1 : 0;
  if (terrain === "plains") {
    const match = FARM_CLEAR_WIDTHS.findIndex((width) => requested <= width);
    const clearing = match < 0 ? FARM_CLEAR_WIDTHS.length - 1 : match;
    return (cache.plains[clearing * 4 + variant] ??= build(
      terrain,
      clearing,
      0,
      variant,
    ));
  }
  let ports = terrain === "river" && options?.ports === undefined ? 9 : 0;
  if ((terrain === "river" || terrain === "lake") && options?.ports)
    for (const port of options.ports)
      if (Number.isInteger(port) && port >= 0 && port < 6) ports |= 1 << port;
  const bend =
    terrain === "river" && OPPOSITE_RIVER_PORTS.includes(ports)
      ? variant
      : terrain === "river" && isHeadwater(ports)
        ? variant & 1
        : 0;
  const index = (bend * CLEAR_WIDTHS.length + bucket) * 64 + ports;
  const model = (cache[terrain][index] ??= build(terrain, bucket, ports, bend));
  return terrain === "hills" && scorched ? scorchedRelief(model) : model;
}
