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
/** Outward bulge of each closed-lake side, per art variant, in tile widths. */
/** Shore radius at each corner, per closed-lake art variant. */
const LAKE_CORNERS = [
  [0.73, 0.76, 0.69, 0.75, 0.7, 0.74],
  [0.66, 0.78, 0.74, 0.68, 0.77, 0.71],
  [0.76, 0.68, 0.72, 0.79, 0.67, 0.73],
  [0.7, 0.74, 0.79, 0.66, 0.72, 0.77],
] as const;
const LAKE_BULGES = [
  [0.045, 0.025, 0.05, 0.035, 0.055, 0.03],
  [0.03, 0.055, 0.025, 0.05, 0.035, 0.045],
  [0.05, 0.04, 0.03, 0.055, 0.025, 0.04],
  [0.035, 0.05, 0.045, 0.025, 0.05, 0.035],
] as const;
const LAKE_SIDE_STEPS = 4;

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
  const side = water ? PALETTE.oceanFloor : PALETTE.earthShade;
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

/** A low sandy berm between two shore points, pushed outward by each point's own offset. */
function bank(
  builder: MeshBuilder,
  a: GroundPoint,
  b: GroundPoint,
  outA: GroundPoint,
  outB: GroundPoint,
  clear: number,
) {
  const outer = (p: GroundPoint, out: GroundPoint, share = 1): GroundPoint => [
    p[0] + out[0] * share,
    p[1] + out[1] * share,
  ];
  const ridge = (p: GroundPoint, out: GroundPoint): Vec3 =>
    point(outer(p, out, 0.6), 0.022);
  raisedFace(
    builder,
    [point(a), point(b), ridge(b, outB), ridge(a, outA)],
    clear,
    PALETTE.sand,
  );
  raisedFace(
    builder,
    [
      ridge(a, outA),
      ridge(b, outB),
      point(outer(b, outB)),
      point(outer(a, outA)),
    ],
    clear,
    PALETTE.grass,
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
    PALETTE.lakeShore,
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
) {
  const [landA, a, b, landB] = from;
  const [landC, c, d, landD] = to;
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
    [a, c, d, b].map((p) => point(p)),
    PALETTE.riverWater,
  );
  if (a !== b || c !== d) {
    const [bedA, bedB] = riverBed(a, b);
    const [bedC, bedD] = riverBed(c, d);
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
): RiverSection {
  const leftBank = along(x, center - halfWidth);
  return [
    along(x, leftLand),
    leftBank,
    halfWidth ? along(x, center + halfWidth) : leftBank,
    along(x, rightLand),
  ];
}

function riverAlongAxis(
  floor: MeshBuilder,
  water: MeshBuilder,
  axis: number,
  profile: readonly ChannelProfile[],
) {
  const along = riverAxis(axis);
  let previous: RiverSection | undefined;
  for (const [x, center, halfWidth] of profile) {
    const land = GROUND_RADIUS * (1 - Math.abs(x));
    const section = channelSection(along, x, center, halfWidth, -land, land);
    if (previous) riverStrip(floor, water, previous, section);
    previous = section;
  }
}

function headwaters(floor: MeshBuilder, water: MeshBuilder, axis: number) {
  const along = riverAxis(axis);
  const profiles = [
    [-0.5, [-0.2, 0], [0, 0], [0.21, 0]],
    [-0.45, [-0.2, 0], [0, 0], [0.22, 0]],
    [-0.39, [-0.21, 0], [-0.012, 0.013], [0.24, 0]],
    [-0.29, [-0.193, 0.014], [0, 0.027], [0.215, 0]],
    [-0.19, [-0.157, 0.023], [0.01, 0.031], [0.174, 0.016]],
    [-0.09, [-0.121, 0.029], [0.007, 0.035], [0.129, 0.029]],
    [0, [-0.08, 0.04], [0, 0.04], [0.08, 0.04]],
  ] as const;
  let previous: RiverSection[] = [];
  for (const [x, ...branches] of profiles) {
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
      );
    });
    previous.forEach((from, index) =>
      riverStrip(floor, water, from, sections[index]),
    );
    previous = sections;
  }
  riverAlongAxis(floor, water, axis, [
    [0, 0, 0.12],
    [0.13, -0.016, 0.136],
    [0.28, -0.022, 0.148],
    [0.4, -0.007, 0.148],
    [0.5, 0, RIVER_PORT_HALF_WIDTH],
  ]);
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
  riverAlongAxis(floor, water, axis, profile);
}

function edgeFraction(p: GroundPoint, a: GroundPoint, b: GroundPoint) {
  const x = b[0] - a[0];
  const z = b[1] - a[1];
  return ((p[0] - a[0]) * x + (p[1] - a[1]) * z) / (x * x + z * z);
}

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

  const exits = HEX.flatMap((a, edge) =>
    ports & (1 << edge) ? [lerp(a, HEX[(edge + 1) % 6], 0.5)] : [],
  );
  if (exits.length === 1) {
    headwaters(floor, water, Math.log2(ports));
    return;
  }

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
  variant: number,
) {
  const shore = HEX.map((p, index) =>
    scaled(p, LAKE_CORNERS[variant & 3][index]),
  );
  if (riverPorts) {
    riverBasin(floor, water, riverPorts, shore, [0, 0]);
    return;
  }
  // Bow each side outward between pinned corners, so a closed lake reads as a
  // natural basin rather than a hexagonal reservoir. The bulges keep it convex.
  const bulges = LAKE_BULGES[variant & 3];
  const curved: GroundPoint[] = [];
  const rim: GroundPoint[] = [];
  const berm: GroundPoint[] = [];
  for (let side = 0; side < 6; side++) {
    const a = shore[side],
      b = shore[(side + 1) % 6];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const normal: GroundPoint = [
      (b[1] - a[1]) / length,
      -(b[0] - a[0]) / length,
    ];
    const outwardSign = normal[0] * a[0] + normal[1] * a[1] > 0 ? 1 : -1;
    for (let step = 0; step < LAKE_SIDE_STEPS; step++) {
      const t = step / LAKE_SIDE_STEPS;
      const bow = bulges[side] * 4 * t * (1 - t) * outwardSign;
      const p = lerp(a, b, t);
      curved.push([p[0] + normal[0] * bow, p[1] + normal[1] * bow]);
      rim.push(lerp(HEX[side], HEX[(side + 1) % 6], t));
      // The berm widens and narrows around the shore.
      const width = 0.009 * (0.5 + ((side * 7 + step * 3 + variant) % 5) / 4);
      const radius = Math.hypot(...curved[curved.length - 1]);
      berm.push(scaled(curved[curved.length - 1], width / radius));
    }
  }
  surface(
    water,
    curved.map((p) => point(p)),
    PALETTE.water,
  );
  for (let i = 0; i < curved.length; i++) {
    const next = (i + 1) % curved.length;
    const a = curved[i],
      b = curved[next];
    surface(
      floor,
      [point(a), point(rim[i]), point(rim[next]), point(b)],
      PALETTE.grass,
    );
    waterBank(floor, a, b, scaled(a, 0.76), scaled(b, 0.76));
    bank(relief, a, b, berm[i], berm[next], clear);
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
      lake(floor, relief, water, clear, mask, variant);
      break;
    case "ocean":
      // The ocean shader derives depth, texture and foam from nearby land.
      ground(water, PALETTE.oceanDeep);
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
        ? "ocean-water"
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
  // Bent rivers and closed lakes have alternative shapes.
  const bend =
    (terrain === "river" && OPPOSITE_RIVER_PORTS.includes(ports)) ||
    (terrain === "lake" && ports === 0)
      ? variant
      : 0;
  const index = (bend * CLEAR_WIDTHS.length + bucket) * 64 + ports;
  const model = (cache[terrain][index] ??= build(terrain, bucket, ports, bend));
  return terrain === "hills" && scorched ? scorchedRelief(model) : model;
}
