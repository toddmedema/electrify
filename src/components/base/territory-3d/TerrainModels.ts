import type { TerrainType } from "../../../Types";
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
const DEPTH = 0.055;
const WATER_FACET: RGB = [
  PALETTE.water[0] * 0.88 + PALETTE.deepWater[0] * 0.12,
  PALETTE.water[1] * 0.88 + PALETTE.deepWater[1] * 0.12,
  PALETTE.water[2] * 0.88 + PALETTE.deepWater[2] * 0.12,
];
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

function substrate(builder: MeshBuilder, water: boolean) {
  const side = water ? PALETTE.deepWater : PALETTE.earthShade;
  for (let i = 0; i < 6; i++) {
    const a = HEX[i],
      b = HEX[(i + 1) % 6];
    builder.quad(point(a), point(b), point(b, -DEPTH), point(a, -DEPTH), side);
    builder.triangle([0, -DEPTH, 0], point(a, -DEPTH), point(b, -DEPTH), side);
  }
}

function ground(builder: MeshBuilder, color: RGB, alternate: RGB) {
  for (let i = 0; i < 6; i++)
    surface(
      builder,
      [[0, 0, 0], point(HEX[i]), point(HEX[(i + 1) % 6])],
      i === 1 || i === 4 ? alternate : color,
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

function river(
  floor: MeshBuilder,
  relief: MeshBuilder,
  water: MeshBuilder,
  ports: number,
  clear: number,
) {
  const inner = HEX.map((p) => scaled(p, 0.27));
  const bed = (p: GroundPoint) => scaled(p, 0.72);
  surface(
    water,
    inner.map((p) => point(p)),
    PALETTE.water,
  );
  for (let i = 0; i < 6; i++) {
    const a = HEX[i],
      b = HEX[(i + 1) % 6],
      ia = inner[i],
      ib = inner[(i + 1) % 6];
    if (ports & (1 << i)) {
      // A fixed 0.18-wide cross-section lies exactly on the shared edge.
      const half = 0.09 / GROUND_RADIUS;
      const wa = lerp(a, b, 0.5 - half),
        wb = lerp(a, b, 0.5 + half),
        iwa = lerp(ia, ib, 0.1),
        iwb = lerp(ia, ib, 0.9);
      surface(
        floor,
        [point(ia), point(a), point(wa), point(iwa)],
        PALETTE.grass,
      );
      surface(
        water,
        [point(iwa), point(wa), point(wb), point(iwb)],
        PALETTE.water,
      );
      surface(
        floor,
        [point(iwb), point(wb), point(b), point(ib)],
        PALETTE.grassShade,
      );
      const iwaBed = lerp(iwa, iwb, 0.23);
      const iwbBed = lerp(iwb, iwa, 0.23);
      waterBank(floor, ia, iwa, bed(ia), bed(iwa));
      waterBank(floor, iwb, ib, bed(iwb), bed(ib));
      waterBank(floor, iwa, wa, iwaBed, lerp(wa, wb, 0.23));
      waterBank(floor, wb, iwb, lerp(wb, wa, 0.23), iwbBed);
      for (const [corner, channel] of [
        [iwa, iwaBed],
        [iwb, iwbBed],
      ])
        surface(
          floor,
          [
            point(corner),
            point(bed(corner), WATERSHED_BANK_DEPTH),
            point(channel, WATERSHED_BANK_DEPTH),
          ],
          PALETTE.earthShade,
        );
      bank(relief, iwa, wa, [a[0] - wa[0], a[1] - wa[1]], clear);
      bank(relief, wb, iwb, [b[0] - wb[0], b[1] - wb[1]], clear);
    } else {
      surface(floor, [point(ia), point(a), point(b), point(ib)], PALETTE.grass);
      waterBank(floor, ia, ib, bed(ia), bed(ib));
    }
  }
}

function lake(
  floor: MeshBuilder,
  relief: MeshBuilder,
  water: MeshBuilder,
  clear: number,
) {
  const shore = HEX.map((p, index) =>
    scaled(p, [0.73, 0.76, 0.69, 0.75, 0.7, 0.74][index]),
  );
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
): MapModel {
  const clear = CLEAR_WIDTHS[bucket] / 2;
  const floor = new MeshBuilder();
  const relief = new MeshBuilder();
  const water = new MeshBuilder();
  let supportY: number | undefined;
  const sharedFloor = terrain === "mountain" ? mountainFloor : undefined;
  if (!sharedFloor) substrate(floor, terrain === "ocean");
  switch (terrain) {
    case "river":
      river(floor, relief, water, mask, clear);
      break;
    case "lake":
      lake(floor, relief, water, clear);
      break;
    case "ocean":
      ground(water, PALETTE.water, WATER_FACET);
      break;
    case "mountain":
      if (!sharedFloor) ground(floor, PALETTE.rock, PALETTE.rockShade);
      supportY = buildMountainRelief(relief, bucket, mask);
      break;
    case "hills":
      ground(floor, PALETTE.grass, PALETTE.grassShade);
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
      ground(floor, PALETTE.grass, PALETTE.grassShade);
      break;
  }
  const raised = relief.build();
  const surfaceWater = water.build();
  const waterPart: ModelPart = {
    mesh: surfaceWater,
    material: terrain === "ocean" ? "water" : "watershed-water",
    castsShadow: false,
    receivesShadow: true,
  };
  let height = 0;
  for (let i = 1; i < raised.positions.length; i += 3)
    height = Math.max(height, raised.positions[i]);
  const floorMesh = sharedFloor ?? floor.build();
  if (terrain === "mountain") mountainFloor = floorMesh;
  return {
    key: `terrain:${terrain}:${bucket}:${mask}`,
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

/** Discrete clearing profiles and six edge bits bound the number of shared meshes. */
export function getTerrainModel(
  terrain: TerrainType,
  options?: TerrainModelOptions,
): MapModel {
  if (terrain === "forest")
    return getForestModel(options, () => {
      const floor = new MeshBuilder();
      substrate(floor, false);
      ground(floor, PALETTE.grassShade, PALETTE.grass);
      return floor.build();
    });
  const requested = options?.footprint ?? 0;
  if (terrain === "mountain") {
    const profile = mountainProfile(requested);
    const edges = (options?.adjacentEdges ?? 0) & 63;
    return (cache.mountain[profile * 64 + edges] ??= build(
      "mountain",
      profile,
      edges,
    ));
  }
  const bucket =
    requested > 0.8 ? 3 : requested > 0.65 ? 2 : requested > 0.55 ? 1 : 0;
  let ports = terrain === "river" && options?.ports === undefined ? 9 : 0;
  if (terrain === "river" && options?.ports)
    for (const port of options.ports)
      if (Number.isInteger(port) && port >= 0 && port < 6) ports |= 1 << port;
  const index = bucket * 64 + ports;
  return (cache[terrain][index] ??= build(terrain, bucket, ports));
}
