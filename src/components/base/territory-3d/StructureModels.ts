import type { CitySizeType } from "../../../Types";
import type { CityGrowthSector } from "../../../helpers/CityDemand";
import {
  biomassConstruction,
  enhancedGeothermalConstruction,
  gasCombinedCycleConstruction,
} from "./IndustrialConstructionModels";
import { MeshBuilder } from "./MeshBuilder";
import { PALETTE as P, rgb } from "./Palette";
import {
  base,
  facilityModel,
  gable,
  model,
  switchgear,
  switchgearDepth,
  windows,
  type FacilityStructureKind,
} from "./StructureMesh";
import type {
  FacilityConstructionStage,
  FacilitySize,
  MapMesh,
  MapModel,
  ModelPart,
  RGB,
  StructureKind,
  Vec3,
} from "./Types";

const models = new Map<string, MapModel>();
const TAU = Math.PI * 2;
const steamMesh = new MeshBuilder()
  .cylinder([0, -0.016, 0], 0.024, 0.034, 0.035, P.smoke, 6)
  .cylinder([0.015, 0.006, -0.005], 0.025, 0.018, 0.03, P.smoke, 5)
  .build();

function steam(position: Vec3, phaseOffset = 0): ModelPart {
  return {
    mesh: steamMesh,
    position,
    motion: "steam",
    phaseOffset,
    hideWhenInactive: true,
    castsShadow: false,
  };
}

function effect(
  mesh: MapMesh,
  motion: "flow" | "pulse",
  position?: Vec3,
): ModelPart {
  return { mesh, position, motion, hideWhenInactive: true, castsShadow: false };
}

type AddCityWindow = (a: Vec3, b: Vec3, c: Vec3, d: Vec3) => void;

function cityWindows(
  window: AddCityWindow,
  x: number,
  y: number,
  z: number,
  width: number,
  depth: number,
): void {
  const pane = width / 5,
    low = y - 0.014,
    high = y + 0.014,
    front = z + depth / 2 + 0.001,
    right = x + width / 2 + 0.001;
  for (const offset of [-width / 4, width / 4]) {
    const left = x + offset - pane / 2;
    window(
      [left, low, front],
      [left + pane, low, front],
      [left + pane, high, front],
      [left, high, front],
    );
  }
  for (const offset of [-depth / 4, depth / 4]) {
    const back = z + offset - pane / 2;
    window(
      [right, low, back + pane],
      [right, low, back],
      [right, high, back],
      [right, high, back + pane],
    );
  }
}

function townhouse(
  mesh: MeshBuilder,
  window: AddCityWindow,
  x: number,
  z: number,
  roof: RGB,
): void {
  mesh.box([x, 0.095, z], [0.1, 0.118, 0.11], P.cream);
  gable(mesh, [x, 0.154, z], [0.116, 0.045, 0.126], roof);
  cityWindows(window, x, 0.117, z, 0.1, 0.11);
  mesh.box([x, 0.065, z + 0.057], [0.022, 0.058, 0.004], P.timber);
}

function cityBlock(
  mesh: MeshBuilder,
  window: AddCityWindow,
  x: number,
  z: number,
  width: number,
  depth: number,
  floors: number,
  roof: RGB,
  setback = false,
): void {
  const floorHeight = 0.056,
    bottom = 0.036,
    lowerFloors = setback ? floors - 2 : floors,
    lowerHeight = lowerFloors * floorHeight + 0.018;
  mesh.box(
    [x, bottom + lowerHeight / 2, z],
    [width, lowerHeight, depth],
    P.cream,
  );
  mesh.box(
    [x, bottom + lowerHeight, z],
    [width + 0.012, 0.012, depth + 0.012],
    roof,
  );
  if (setback) {
    const upperHeight = 2 * floorHeight;
    mesh.box(
      [x, bottom + lowerHeight + upperHeight / 2, z],
      [width - 0.032, upperHeight, depth - 0.032],
      P.cream,
    );
    mesh.box(
      [x, bottom + lowerHeight + upperHeight, z],
      [width - 0.02, 0.012, depth - 0.02],
      roof,
    );
  }
  for (let floor = 0; floor < floors; floor++) {
    const inset = setback && floor >= lowerFloors ? 0.032 : 0;
    cityWindows(
      window,
      x,
      bottom + 0.041 + floor * floorHeight,
      z,
      width - inset,
      depth - inset,
    );
  }
}

function workshop(
  mesh: MeshBuilder,
  window: AddCityWindow,
  x: number,
  z: number,
): void {
  mesh
    .box([x, 0.018, z], [0.154, 0.036, 0.133], P.steel)
    .box([x, 0.079, z], [0.136, 0.086, 0.099], P.cream)
    .box([x + 0.025, 0.062, z + 0.05], [0.04, 0.052, 0.005], P.steelShade);
  // Two short roof bays and high windows give the workshop a different silhouette from housing.
  for (const offset of [-0.035, 0.035]) {
    const left = x + offset - 0.035;
    const right = left + 0.07;
    const back = z - 0.055;
    const front = z + 0.055;
    mesh
      .quad(
        [left, 0.122, back],
        [left, 0.122, front],
        [right, 0.163, front],
        [right, 0.163, back],
        P.steelShade,
      )
      .quad(
        [right, 0.122, back],
        [right, 0.163, back],
        [right, 0.163, front],
        [right, 0.122, front],
        P.steel,
      )
      .triangle(
        [left, 0.122, front],
        [right, 0.122, front],
        [right, 0.163, front],
        P.steel,
      )
      .triangle(
        [right, 0.122, back],
        [left, 0.122, back],
        [right, 0.163, back],
        P.steel,
      );
  }
  const front = z + 0.0515;
  window(
    [x - 0.0495, 0.094, front],
    [x - 0.0145, 0.094, front],
    [x - 0.0145, 0.108, front],
    [x - 0.0495, 0.108, front],
  );
}

function city(
  size: CitySizeType,
  growth: readonly CityGrowthSector[],
  key: string,
): MapModel {
  const body = new MeshBuilder();
  const glazing = new MeshBuilder();
  let pane = 0;
  const window: AddCityWindow = (a, b, c, d) => {
    // The city-window material reads the red channel as a stable threshold.
    // A golden-ratio step spreads partial lighting across the skyline.
    const threshold = (pane++ * 0.61803398875) % 1;
    glazing.quad(a, b, c, d, [threshold, 0, 0]);
  };
  // A shared street and pocket park tie the three skylines into one city family.
  body
    .box([0, 0.018, 0], [0.64, 0.036, 0.46], P.steel)
    .box([0, 0.04, 0.045], [0.62, 0.008, 0.065], P.steelShade)
    .box([0.115, 0.04, -0.09], [0.035, 0.008, 0.25], P.steelShade)
    .box([0.225, 0.041, -0.125], [0.165, 0.01, 0.155], P.grass);
  for (const x of [-0.24, -0.12, 0, 0.24])
    body.box([x, 0.045, 0.045], [0.045, 0.002, 0.006], P.cream);
  for (const [x, z] of [
    [0.19, -0.15],
    [0.265, -0.105],
  ])
    body
      .cylinder([x, 0.046, z], 0.006, 0.006, 0.04, P.timber, 5)
      .cylinder([x, 0.073, z], 0.032, 0.018, 0.048, P.forestLight, 5);

  if (size === "small") {
    townhouse(body, window, -0.225, -0.105, P.forest);
    townhouse(body, window, -0.075, -0.105, P.steelShade);
    townhouse(body, window, 0.035, -0.105, P.timber);
    townhouse(body, window, 0.205, 0.16, P.forest);
    cityBlock(body, window, -0.17, 0.155, 0.13, 0.11, 3, P.steelShade);
  } else if (size === "medium") {
    cityBlock(body, window, -0.215, -0.12, 0.13, 0.14, 4, P.forest);
    cityBlock(body, window, -0.035, -0.12, 0.15, 0.14, 5, P.steelShade);
    cityBlock(body, window, -0.025, 0.16, 0.15, 0.11, 3, P.steelShade);
    townhouse(body, window, -0.225, 0.16, P.timber);
    townhouse(body, window, 0.205, 0.16, P.forest);
  } else {
    cityBlock(body, window, -0.215, -0.125, 0.14, 0.15, 6, P.forest);
    cityBlock(body, window, -0.025, -0.125, 0.16, 0.16, 9, P.steelShade, true);
    cityBlock(body, window, -0.085, 0.16, 0.13, 0.11, 4, P.steelShade);
    cityBlock(body, window, 0.08, 0.16, 0.13, 0.11, 6, P.forest);
    townhouse(body, window, -0.24, 0.16, P.timber);
    townhouse(body, window, 0.24, 0.16, P.forest);
  }
  // Each sector has a separate lot. Adding a block never moves an existing building or terminal.
  const firstGrowthPane = pane;
  if (growth.includes("Residential")) {
    body.box([-0.334, 0.018, 0.025], [0.136, 0.036, 0.147], P.steel);
    townhouse(body, window, -0.334, 0.025, P.forest);
  }
  pane = firstGrowthPane + 4; // Reserve the townhouse's panes until it is built.
  if (growth.includes("Commercial")) {
    const shopX = 0.356,
      shopZ = 0.091;
    body.box([shopX, 0.018, shopZ], [0.134, 0.036, 0.134], P.steel);
    cityBlock(body, window, shopX, shopZ, 0.094, 0.104, 2, P.timber);
    body.box([shopX, 0.104, shopZ + 0.057], [0.094, 0.025, 0.022], P.forest);
  }
  pane = firstGrowthPane + 12; // Reserve the two-story commercial block as well.
  if (growth.includes("Industrial")) workshop(body, window, 0.198, 0.297);
  return model(key, body, switchgear(body, 0.27), [
    { mesh: glazing.build(), material: "city-window", castsShadow: false },
  ]);
}

const towerConstructionStages = 16;

export function getTowerConstructionModel(progress: number): MapModel {
  const stage = Math.floor(
    Math.max(0, Math.min(1, progress)) * towerConstructionStages,
  );
  const key = `tower:construction:${stage}`;
  const cached = models.get(key);
  if (cached) return cached;
  const result = tower(stage / towerConstructionStages, key);
  models.set(key, result);
  return result;
}

function tower(progress = 1, key = "tower"): MapModel {
  const body = new MeshBuilder();
  const height = 0.29 * progress;
  const steel = P.steelShade;
  for (const x of [-1, 1])
    for (const z of [-1, 1]) {
      body.box([x * 0.045, 0.008, z * 0.025], [0.024, 0.016, 0.024], P.rock);
      if (height > 0)
        body.beam(
          [x * 0.045, 0, z * 0.025],
          [
            x * (0.045 - progress * 0.028),
            height,
            z * (0.025 - progress * 0.013),
          ],
          0.006,
          steel,
        );
    }
  for (const y of [0.09, 0.18]) {
    if (height <= y) break;
    const width = 0.045 - y * 0.095;
    const ratio = Math.min(1, (height - y) / 0.075);
    for (const side of [-1, 1])
      body.beam(
        [side * width, y, 0.018],
        [
          side * width * (1 - 2 * ratio),
          y + 0.075 * ratio,
          0.018 - 0.004 * ratio,
        ],
        0.0035,
        steel,
      );
  }
  const terminals: Vec3[] = [];
  if (height >= 0.269) {
    body.box([0, 0.245, 0], [0.17, 0.012, 0.016], steel);
    for (const x of [-0.08, 0.08]) {
      body.cylinder([x, 0.251, 0], 0.009, 0.009, 0.018, P.steel);
      terminals.push([x, 0.269, 0]);
    }
  }
  return model(key, body, terminals);
}

const shatteredBacking = rgb("#192b38");
const fracturedGlass = rgb("#8bbbd7");

function shatteredPanel(panel: MeshBuilder, center: number) {
  const a = center - 0.106;
  const b = center + 0.106;
  // Leave dark backing exposed between the broken, uneven glass edges.
  panel
    .box([center, 0.009, 0], [0.212, 0.004, 0.14], shatteredBacking)
    .triangle(
      [a, 0.014, -0.07],
      [center - 0.024, 0.021, 0.007],
      [center + 0.042, 0.014, -0.07],
      P.solar,
    )
    .triangle(
      [a, 0.014, -0.07],
      [a, 0.014, 0.048],
      [center - 0.024, 0.021, 0.007],
      fracturedGlass,
    )
    .triangle(
      [b, 0.014, -0.061],
      [center + 0.022, 0.019, 0.014],
      [b, 0.014, 0.07],
      P.solar,
    )
    .triangle(
      [b, 0.014, 0.07],
      [center + 0.022, 0.019, 0.014],
      [center - 0.048, 0.017, 0.07],
      fracturedGlass,
    )
    .triangle(
      [center - 0.072, 0.013, 0.059],
      [center - 0.03, 0.013, 0.052],
      [center - 0.047, 0.023, 0.014],
      P.steel,
    );
}

const solarLayouts = {
  small: {
    rows: [-0.09, 0.09],
    width: 0.41,
    height: 0.098,
    supportX: 0.15,
    feederX: 0.25,
    feederZ: 0.206,
  },
  medium: {
    rows: [-0.18, 0, 0.18],
    width: 0.6,
    height: 0.115,
    supportX: 0.23,
    feederX: 0.34,
    feederZ: 0.29,
  },
  large: {
    rows: [-0.25, -0.122, 0.122, 0.25],
    width: 0.66,
    height: 0.127,
    supportX: 0.25,
    feederX: 0.37,
    feederZ: 0.353,
  },
};

function solar(
  damaged: boolean,
  size: FacilitySize,
  stage?: FacilityConstructionStage,
): MapModel {
  const body = new MeshBuilder(),
    glints = new MeshBuilder();
  const { rows, width, height, supportX, feederX, feederZ } =
    solarLayouts[size];
  const halfWidth = width / 2,
    tilt = 0.36;
  const panelRows =
    stage === 1 ? 0 : stage === 2 ? Math.ceil(rows.length / 2) : rows.length;
  for (const [index, z] of rows.entries()) {
    // Exposed footing forms surround the posts until installation is complete.
    if (stage !== undefined && stage < 3)
      for (const x of [-supportX, supportX])
        for (const dz of [-0.045, 0.045])
          body.box(
            [x, 0.012, z + dz * Math.cos(tilt)],
            [0.044, 0.024, 0.04],
            P.rock,
          );
    if (stage === 0) continue;
    const paneled = index < panelRows;
    const broken = damaged && (index === 1 || index === rows.length - 1);
    if (paneled) {
      const center = (halfWidth - 0.136) * (index === 1 ? -1 : 1);
      const panel = new MeshBuilder().box(
        [0, 0, 0],
        [width + 0.012, 0.014, 0.152],
        P.steel,
      );
      const intact = broken
        ? [
            [-halfWidth, center - 0.106],
            [center + 0.106, halfWidth],
          ]
        : [[-halfWidth, halfWidth]];
      for (const [left, right] of intact) {
        const mid = (left + right) / 2;
        panel
          .box([mid, 0.009, 0], [right - left, 0.004, 0.14], P.solar)
          .box([mid, 0.012, 0], [right - left, 0.002, 0.003], P.steel);
      }
      for (const x of [-width / 4, 0, width / 4])
        if (!broken || Math.abs(center - x) > 0.106)
          panel.box([x, 0.012, 0], [0.003, 0.002, 0.14], P.steel);
      if (broken) shatteredPanel(panel, center);
      if (size !== "medium")
        panel.box(
          [0, 0.015, -0.071],
          [width + 0.012, 0.004, 0.01],
          P.steelShade,
        );
      body.merge(panel.build(), [0, height, z], [tilt, 0, 0]);
    } else {
      const rack = new MeshBuilder();
      for (const dz of [-0.045, 0.045])
        rack.box([0, -0.005, dz], [width + 0.012, 0.018, 0.023], P.steel);
      for (const x of [-supportX, supportX])
        rack.box([x, -0.005, 0], [0.02, 0.016, 0.14], P.steelShade);
      body.merge(rack.build(), [0, height, z], [tilt, 0, 0]);
    }
    for (const x of [-supportX, supportX])
      for (const dz of [-0.045, 0.045]) {
        const top = height - 0.008 - Math.sin(tilt) * dz;
        body.box(
          [x, top / 2, z + dz * Math.cos(tilt)],
          [0.012, top, 0.012],
          P.steelShade,
        );
      }
    if (!broken && stage === undefined)
      glints.merge(
        new MeshBuilder()
          .box([0, 0.014, -0.037], [width - 0.02, 0.002, 0.01], P.solar)
          .build(),
        [0, height, z],
        [tilt, 0, 0],
      );
  }
  if (damaged) {
    const shardsX = halfWidth - (size === "large" ? 0.07 : 0.06),
      shardsZ = feederZ - 0.02;
    body
      .triangle(
        [shardsX, 0.004, shardsZ],
        [shardsX + 0.04, 0.006, shardsZ + 0.01],
        [shardsX + 0.02, 0.004, shardsZ + 0.04],
        fracturedGlass,
      )
      .triangle(
        [-shardsX - 0.02, 0.004, shardsZ + 0.02],
        [-shardsX - 0.05, 0.006, shardsZ + 0.01],
        [-shardsX - 0.007, 0.004, shardsZ - 0.002],
        P.solar,
      );
  }
  if (stage !== undefined && stage < 3) return facilityModel("solar", body, []);

  // Bring the conductors out beside the racks via low feeders under the panels.
  const terminals: Vec3[] = [
    [-feederX, 0.036, 0],
    [feederX, 0.036, 0],
    [0, 0.036, -feederZ],
    [0, 0.036, feederZ],
  ];
  body.box([0, 0.023, 0], [0.13, 0.046, 0.1], P.steel);
  for (const terminal of terminals) {
    if (stage === 3 && terminal[2] === feederZ) {
      // The export link still has an open joint below its protective work stand.
      body
        .beam(
          [0, terminal[1], 0],
          [0, terminal[1], feederZ - 0.08],
          0.006,
          P.ink,
        )
        .box([0.045, 0.023, feederZ - 0.015], [0.045, 0.046, 0.048], P.timber)
        .box([0.045, 0.052, feederZ - 0.015], [0.055, 0.014, 0.053], P.earth);
    } else body.beam([0, terminal[1], 0], terminal, 0.006, P.ink);
    body
      .cylinder(
        [terminal[0], 0.015, terminal[2]],
        0.014,
        0.014,
        0.03,
        P.steelShade,
      )
      .cylinder([terminal[0], 0.03, terminal[2]], 0.01, 0.01, 0.006, P.cream);
  }
  return facilityModel(
    damaged ? "solar-hail-damaged" : "solar",
    body,
    terminals,
    stage === undefined ? [effect(glints.build(), "pulse")] : [],
  );
}

const turbineWhite: RGB = [1, 1, 1];

/** A small solid loft: rounded +X leading edge, thin -X trailing edge. */
function windBlade(spanScale: number, chordScale: number): MapMesh {
  const mesh = new MeshBuilder();
  // Span, backward sweep, upwind prebend, chord, depth, pitch (radians).
  // Sweep changes the front silhouette; prebend independently clears the tower.
  const sections = [
    [0.02, 0, 0, 0.026, 0.022, 0.3],
    [0.06, -0.002, 0, 0.052, 0.016, 0.22],
    [0.12, -0.004, 0.001, 0.042, 0.011, 0.14],
    [0.2, -0.009, 0.003, 0.027, 0.006, 0.07],
    [0.255, -0.016, 0.005, 0.012, 0.003, 0.03],
    [0.28, -0.023, 0.006, 0.003, 0.0015, 0],
  ].map(([span, sweep, prebend, chord, depth, pitch]) => [
    span * spanScale,
    sweep * spanScale,
    prebend,
    chord * chordScale,
    depth * chordScale,
    pitch,
  ]);
  const profile = [
    [-0.5, -0.03],
    [-0.05, -0.5],
    [0.4, -0.36],
    [0.5, 0],
    [0.4, 0.36],
    [-0.05, 0.5],
    [-0.5, 0.03],
  ];
  const rings = sections.map(([span, sweep, prebend, chord, depth, pitch]) =>
    profile.map(([u, v]): Vec3 => [
      sweep + u * chord * Math.cos(pitch) - v * depth * Math.sin(pitch),
      span,
      prebend + u * chord * Math.sin(pitch) + v * depth * Math.cos(pitch),
    ]),
  );
  for (let span = 0; span < rings.length - 1; span++)
    for (let edge = 0; edge < profile.length; edge++) {
      const next = (edge + 1) % profile.length;
      mesh.quad(
        rings[span][edge],
        rings[span + 1][edge],
        rings[span + 1][next],
        rings[span][next],
        turbineWhite,
      );
    }
  for (let edge = 0; edge < profile.length; edge++) {
    const next = (edge + 1) % profile.length,
      tip = sections.length - 1;
    mesh.triangle(
      [sections[0][1], sections[0][0], sections[0][2]],
      rings[0][edge],
      rings[0][next],
      turbineWhite,
    );
    mesh.triangle(
      [sections[tip][1], sections[tip][0], sections[tip][2]],
      rings[tip][next],
      rings[tip][edge],
      turbineWhite,
    );
  }
  return mesh.build();
}

function onshoreWindConstruction(
  size: FacilitySize,
  stage: FacilityConstructionStage,
): MapModel {
  const { mast, tower } = windDesigns[size],
    large = size === "large",
    deck = large ? 0.045 : 0.035,
    width = large ? 0.335 : size === "small" ? 0.128 : 0.16,
    depth = large ? 0.205 : width - 0.01,
    baseRadius = 0.026 * tower,
    body = new MeshBuilder();
  body.box([0, deck / 2, 0], [width, deck, depth], P.steel);
  if (large) {
    for (const x of [-0.117, 0.118])
      body.box([x, deck + 0.009, 0.027], [0.069, 0.018, 0.092], P.steelShade);
  }
  if (stage === 0) {
    body.cylinder(
      [0, deck, 0],
      0.048 * tower,
      0.048 * tower,
      0.009,
      P.steelShade,
      8,
    );
    for (const x of [-1, 1])
      for (const z of [-1, 1])
        body.cylinder(
          [x * 0.026 * tower, deck + 0.009, z * 0.026 * tower],
          0.007 * tower,
          0.007 * tower,
          0.017 * tower,
          P.cream,
        );
    return facilityModel("wind", body, []);
  }

  const partial = stage === 1,
    height = partial ? mast * 0.42 : mast,
    topRadius = (partial ? 0.0214 : 0.015) * tower;
  body.cylinder([0, deck, 0], baseRadius, topRadius, height, turbineWhite, 8);
  if (partial) {
    body.cylinder(
      [0, deck + height, 0],
      0.032 * tower,
      0.031 * tower,
      0.013 * tower,
      P.steelShade,
      8,
    );
    body.cylinder(
      [0, deck + height + 0.013 * tower, 0],
      0.021 * tower,
      0.021 * tower,
      0.002,
      P.ink,
      8,
    );
    return facilityModel("wind", body, []);
  }

  const nacelleY = deck + mast - 0.005;
  body.box(
    [0, nacelleY, 0],
    [0.07 * tower, 0.045 * tower, 0.1 * tower],
    turbineWhite,
  );
  if (large) {
    body.box([-0.117, 0.072, 0.027], [0.069, 0.054, 0.092], P.steelShade);
    body.box([-0.117, 0.101, 0.027], [0.073, 0.008, 0.097], P.cream);
    body.box([0.118, 0.064, 0.027], [0.064, 0.04, 0.092], P.steelShade);
  }
  if (stage === 2) {
    // The open drive face marks the next installation before the rotor goes up.
    body.box(
      [0, nacelleY, 0.058 * tower],
      [0.054 * tower, 0.037 * tower, 0.022 * tower],
      P.steelShade,
    );
    body.box(
      [0, nacelleY, 0.071 * tower],
      [0.02 * tower, 0.022 * tower, 0.012 * tower],
      P.timber,
    );
    return facilityModel("wind", body, []);
  }

  // Park the exact completed rotor without starting its operating motion.
  const rotor = getStructureModel("wind", [], size).parts.find(
    (part) => part.motion === "rotor",
  );
  if (rotor) body.merge(rotor.mesh, rotor.position, [0, 0, -Math.PI / 12]);

  const gearZ = 0.12;
  body.box([0, 0.01, gearZ], [0.24, 0.02, switchgearDepth], P.steelShade);
  const terminals = switchgear(body, gearZ);
  // Show the open service panel and its detached cover during wiring.
  body.box([0, 0.063, gearZ + 0.032], [0.084, 0.05, 0.004], P.ink);
  for (const x of [-0.022, 0.022])
    body.box([x, 0.063, gearZ + 0.035], [0.012, 0.034, 0.006], P.timber);
  body.box([0.165, 0.014, gearZ], [0.042, 0.028, 0.044], P.timber);
  body.box([0.165, 0.032, gearZ], [0.061, 0.008, 0.048], P.steel);
  return facilityModel("wind", body, terminals);
}

const windDesigns = {
  small: { mast: 0.327, tower: 0.8, span: 0.71, chord: 0.84 },
  medium: { mast: 0.48, tower: 1, span: 1, chord: 1 },
  large: { mast: 0.59, tower: 1.24, span: 1.34, chord: 1.25 },
};

const offshoreDeckThickness = 0.025;
const offshoreDecks = {
  small: { height: 0.062, width: 0.23, depth: 0.175, legX: 0.076, legZ: 0.06 },
  medium: { height: 0.09, width: 0.3, depth: 0.25, legX: 0.1, legZ: 0.08 },
  large: { height: 0.107, width: 0.435, depth: 0.29, legX: 0.154, legZ: 0.1 },
};

function wind(kind: "wind" | "offshore-wind", size: FacilitySize): MapModel {
  const offshore = kind === "offshore-wind",
    body = new MeshBuilder();
  const { mast, tower, span, chord } = windDesigns[size],
    platform = offshoreDecks[size],
    deck = offshore ? platform.height : size === "large" ? 0.045 : 0.035;
  if (offshore) {
    const { legX, legZ, width, depth } = platform;
    const legFootY = size === "large" ? 0.009 : 0.006;
    const braceFootY = size === "large" ? 0.009 : 0.005;
    for (const x of [-legX, legX])
      for (const z of [-legZ, legZ]) {
        body.beam(
          [x * 1.3, legFootY, z * 1.3],
          [x, deck, z],
          0.012 * tower,
          P.steelShade,
        );
        body.beam(
          [-x, braceFootY, z],
          [x, deck, z],
          0.006 * tower,
          P.steelShade,
        );
      }
    body.box([0, deck, 0], [width, offshoreDeckThickness, depth], P.steel);
    if (size === "large") {
      // The service deck carries a crane and has a separate landing for switchgear.
      body.box([0, 0.045, 0.16], [0.255, 0.06, 0.082], P.steelShade);
      body.box([-0.153, deck + 0.045, 0.057], [0.071, 0.064, 0.075], P.cream);
      body.box([0.151, deck + 0.028, 0.06], [0.085, 0.03, 0.067], P.timber);
      body.beam(
        [0.15, deck + 0.037, 0.06],
        [0.15, 0.228, 0.06],
        0.016,
        P.timber,
        4,
      );
      body.beam([0.15, 0.221, 0.06], [0.225, 0.254, 0.06], 0.012, P.timber, 4);
      body.beam(
        [0.225, 0.254, 0.06],
        [0.225, 0.209, 0.06],
        0.005,
        P.steelShade,
        4,
      );
    }
  } else if (size === "large") {
    body.box([0, deck / 2, 0], [0.335, deck, 0.205], P.steel);
    body.box([-0.117, 0.072, 0.027], [0.069, 0.054, 0.092], P.steelShade);
    body.box([-0.117, 0.101, 0.027], [0.073, 0.008, 0.097], P.cream);
    body.box([0.118, 0.064, 0.027], [0.064, 0.04, 0.092], P.steelShade);
  } else {
    const width = size === "small" ? 0.128 : 0.16;
    body.box([0, deck / 2, 0], [width, deck, width - 0.01], P.steel);
  }

  body.cylinder(
    [0, deck, 0],
    0.026 * tower,
    0.015 * tower,
    mast,
    turbineWhite,
    8,
  );
  const pivot: Vec3 = [0, deck + mast - 0.005, 0.045 * tower];
  body.box(
    [0, pivot[1], 0],
    [0.07 * tower, 0.045 * tower, 0.1 * tower],
    turbineWhite,
  );
  const rotor = new MeshBuilder();
  const blade = windBlade(span, chord);
  for (let i = 0; i < 3; i++)
    rotor.merge(blade, [0, 0, 0], [0, 0, (i * TAU) / 3]);
  rotor.merge(
    new MeshBuilder()
      .cylinder(
        [0, 0, 0],
        0.025 * chord,
        0.018 * chord,
        0.028 * chord,
        turbineWhite,
        8,
      )
      .build(),
    [0, 0, 0.022],
    [Math.PI / 2, 0, 0],
  );
  const terminals =
    offshore && size === "small"
      ? switchgear(body, (platform.depth - switchgearDepth) / 2 - 0.005, {
          bottom: deck + offshoreDeckThickness / 2,
          width: platform.width - 0.01,
          height: 0.07,
        })
      : switchgear(body, offshore && size === "large" ? 0.169 : 0.12);
  return facilityModel(kind, body, terminals, [
    {
      mesh: rotor.build(),
      position: pivot,
      motion: "rotor",
      castsShadow: true,
    },
  ]);
}

function offshoreWindConstruction(
  size: FacilitySize,
  stage: FacilityConstructionStage,
): MapModel {
  const body = new MeshBuilder();
  const { mast, tower } = windDesigns[size];
  const { height: deck, width, depth, legX, legZ } = offshoreDecks[size];
  const legFootY = size === "large" ? 0.009 : 0.006;
  const braceFootY = size === "large" ? 0.009 : 0.005;
  for (const x of [-legX, legX])
    for (const z of [-legZ, legZ]) {
      body.beam(
        [x * 1.3, legFootY, z * 1.3],
        [x, deck, z],
        0.012 * tower,
        P.steelShade,
      );
      body.beam([-x, braceFootY, z], [x, deck, z], 0.006 * tower, P.steelShade);
      if (stage === 0) {
        body.cylinder([x, deck - 0.008, z], 0.018, 0.018, 0.014, P.steel);
        body.cylinder([x, deck + 0.006, z], 0.012, 0.012, 0.006, P.ink);
      }
    }
  if (stage === 0) return facilityModel("offshore-wind", body, []);

  const deckTop = deck + offshoreDeckThickness / 2;
  body.box([0, deck, 0], [width, offshoreDeckThickness, depth], P.steel);
  if (size === "large") {
    // The lower service landing grows with the permanent platform.
    body.beam([-0.11, deck, legZ], [-0.11, 0.045, 0.17], 0.012, P.steelShade);
    body.beam([0.11, deck, legZ], [0.11, 0.045, 0.17], 0.012, P.steelShade);
    body.box([0, 0.045, 0.16], [0.255, 0.06, 0.082], P.steelShade);
    body.box([-0.153, deck + 0.045, 0.057], [0.071, 0.064, 0.075], P.cream);
  }
  const mastSection = stage === 1 ? mast * 0.36 : mast;
  body.cylinder(
    [0, deck, 0],
    0.026 * tower,
    (stage === 1 ? 0.022 : 0.015) * tower,
    mastSection,
    turbineWhite,
    8,
  );
  if (stage === 1) {
    body.cylinder(
      [0, deck + mastSection - 0.006, 0],
      0.028 * tower,
      0.028 * tower,
      0.012,
      P.steelShade,
      8,
    );
    return facilityModel("offshore-wind", body, []);
  }

  const hubY = deck + mast - 0.005;
  body.box(
    [0, hubY, 0],
    [0.07 * tower, 0.045 * tower, 0.1 * tower],
    turbineWhite,
  );
  if (stage === 2) {
    body.box(
      [0, hubY, 0.052 * tower],
      [0.041 * tower, 0.034 * tower, 0.009],
      P.steelShade,
    );
    return facilityModel("offshore-wind", body, []);
  }

  const installedRotor = getStructureModel(
    "offshore-wind",
    [],
    size,
  ).parts.find((part) => part.motion === "rotor")!;
  // Park the finished rotor as static construction geometry.
  body.merge(installedRotor.mesh, installedRotor.position, [0, 0, Math.PI / 8]);
  const landingZ =
    size === "small"
      ? (depth - switchgearDepth) / 2 - 0.005
      : size === "large"
        ? 0.169
        : 0.12;
  if (size === "medium") {
    // Support the cabinet's overhang on a landing that meets the fitted deck.
    body.box([0, deck, 0.1325], [0.252, offshoreDeckThickness, 0.045], P.steel);
    for (const x of [-legX, legX])
      body.beam(
        [x * 1.2, legFootY + (deck - legFootY) / 3, legZ * 1.2],
        [x, deck - offshoreDeckThickness / 2, 0.147],
        0.011,
        P.steelShade,
      );
  }
  const cabinetBottom = size === "large" ? 0.075 : deckTop;
  const terminals = switchgear(body, landingZ, {
    bottom: cabinetBottom,
    width: size === "small" ? width - 0.01 : 0.24,
    height: size === "small" ? 0.07 : 0.02 + 0.09 - cabinetBottom,
  });
  const trayY = deckTop + 0.006;
  const trayX = Math.min(width * 0.34, 0.1);
  const trayStart = -depth * 0.4;
  const trayEnd = Math.min(landingZ, depth / 2);
  const gapStart = -depth * 0.18;
  const gapEnd = gapStart + 0.037;
  // Permanent external terminals sit above a deck cable that still has an open splice.
  body
    .box(
      [0, trayY, (trayStart - 0.022) / 2],
      [0.022, 0.012, -0.022 - trayStart],
      P.ink,
    )
    .box([trayX / 2, trayY, trayStart], [trayX, 0.012, 0.022], P.ink)
    .box(
      [trayX, trayY, (trayStart + gapStart) / 2],
      [0.022, 0.012, gapStart - trayStart],
      P.ink,
    )
    .box(
      [trayX, trayY, (gapEnd + trayEnd) / 2],
      [0.022, 0.012, trayEnd - gapEnd],
      P.ink,
    )
    .box([trayX, trayY + 0.008, gapStart], [0.029, 0.022, 0.016], P.timber);
  return facilityModel("offshore-wind", body, terminals);
}

const kiteDesigns = {
  small: {
    baseWidth: 0.242,
    baseDepth: 0.185,
    hallWidth: 0.17,
    hallDepth: 0.13,
    hallHeight: 0.067,
    wingHeight: 0.453,
    span: 0.72,
    chord: 0.78,
  },
  medium: {
    baseWidth: 0.3,
    baseDepth: 0.23,
    hallWidth: 0.23,
    hallDepth: 0.17,
    hallHeight: 0.085,
    wingHeight: 0.64,
    span: 1,
    chord: 1,
  },
  large: {
    baseWidth: 0.51,
    baseDepth: 0.37,
    hallWidth: 0.267,
    hallDepth: 0.22,
    hallHeight: 0.12,
    wingHeight: 0.665,
    span: 1.29,
    chord: 1.24,
  },
};

function airborne(
  size: FacilitySize,
  stage?: FacilityConstructionStage,
): MapModel {
  const body = new MeshBuilder();
  const {
    baseWidth,
    baseDepth,
    hallWidth,
    hallDepth,
    hallHeight,
    wingHeight,
    span,
    chord,
  } = kiteDesigns[size];
  base(body, baseWidth, baseDepth);
  const hallCenter = 0.0355 + hallHeight / 2;
  const winchSeats = size === "large" ? [-0.184, 0.184] : [0];
  const hallClosed = stage === undefined || stage >= 2;
  if (hallClosed) {
    body.box([0, hallCenter, 0], [hallWidth, hallHeight, hallDepth], P.cream);
  } else {
    body.box([0, 0.041, 0], [hallWidth, 0.01, hallDepth], P.rock);
  }
  if (stage === 0) {
    const width = size === "large" ? 0.095 : hallWidth * 0.64;
    for (const x of winchSeats) {
      body.box([x, 0.048, hallDepth * 0.36], [width, 0.024, 0.066], P.rock);
      for (const side of [-1, 1])
        body.box(
          [x + side * width * 0.32, 0.069, hallDepth * 0.36],
          [0.014, 0.018, 0.026],
          P.steel,
        );
    }
    return facilityModel("airborne-wind", body, []);
  }
  if (stage === 1) {
    const frameWidth = hallWidth / 2 - 0.014;
    const frameDepth = hallDepth / 2 - 0.014;
    for (const side of [-1, 1]) {
      body.box(
        [side * frameWidth, hallCenter, frameDepth],
        [0.027, hallHeight, 0.027],
        P.steel,
      );
      body.box(
        [side * frameWidth, hallCenter, -0.003],
        [0.027, hallHeight * 0.48, hallDepth - 0.022],
        P.cream,
      );
    }
    body.box(
      [0, hallCenter, -frameDepth],
      [hallWidth, hallHeight, 0.028],
      P.cream,
    );
    body.box(
      [0, 0.03 + hallHeight, frameDepth],
      [hallWidth, 0.018, 0.024],
      P.steel,
    );
  }
  const winchRadius = size === "small" ? 0.033 : 0.046;
  const launchDrum = new MeshBuilder()
    .cylinder(
      [0, 0, 0],
      winchRadius,
      winchRadius,
      size === "small" ? 0.086 : 0.13,
      P.steelShade,
      8,
    )
    .build();
  if (size === "large") {
    if (hallClosed) body.box([0, 0.162, 0], [0.285, 0.014, 0.238], P.steel);
    for (const x of winchSeats) {
      body.box([x, 0.052, 0.061], [0.095, 0.04, 0.132], P.steel);
      body.merge(launchDrum, [x, 0.093, 0.007], [Math.PI / 2, 0, 0]);
      if (stage === undefined)
        body.beam(
          [x, 0.13, 0.072],
          [0, wingHeight - 0.18, 0],
          0.005,
          P.steelShade,
        );
    }
    if (stage === undefined)
      body.beam(
        [0, wingHeight - 0.18, 0],
        [0, wingHeight, 0],
        0.005,
        P.steelShade,
      );
  } else {
    body.merge(
      launchDrum,
      size === "small" ? [-0.05, 0.075, 0.047] : [-0.065, 0.09, 0.065],
      [0, 0, -Math.PI / 2],
    );
    if (stage === undefined)
      body.beam(
        [0, size === "small" ? 0.101 : 0.12, 0],
        [0, wingHeight, 0],
        0.004,
        P.steelShade,
      );
  }
  if (stage === 1) return facilityModel("airborne-wind", body, []);

  let wingPosition: Vec3 = [0, wingHeight, 0];
  if (stage !== undefined) {
    const cradleDepth = hallDepth / 2 + 0.037;
    const cradleHeight = 0.082 + hallHeight;
    const wingY = stage === 2 ? cradleHeight + 0.02 : wingHeight * 0.63;
    wingPosition = [0, wingY, stage === 2 ? cradleDepth : 0.036];
    // Clear the two work trestles before the static tether test.
    if (stage === 2)
      for (const side of [-1, 1]) {
        const x = side * 0.19 * span;
        body.box(
          [x, cradleHeight + 0.005, cradleDepth],
          [0.07, 0.023, 0.042],
          P.earth,
        );
        for (const leg of [-1, 1])
          body.beam(
            [x + leg * 0.033, 0.028, cradleDepth + 0.017],
            [x + leg * 0.017, cradleHeight, cradleDepth],
            0.012,
            P.timber,
          );
      }
    if (size === "large") {
      const junction: Vec3 = [0, 0.18, cradleDepth + 0.031];
      for (const x of winchSeats)
        body.beam([x, 0.129, 0.11], junction, 0.005, P.steelShade);
      body.beam(junction, wingPosition, 0.006, P.steelShade);
    } else {
      const takeoff: Vec3 =
        size === "small" ? [0, 0.106, 0.047] : [0, 0.135, 0.065];
      body.beam(takeoff, wingPosition, 0.005, P.steelShade);
    }
  }
  const wing = new MeshBuilder();
  const outline: Vec3[] = [
    [-0.33, 0, 0.01],
    [-0.11, 0.025, -0.12],
    [0, 0.045, -0.075],
    [0.11, 0.025, -0.12],
    [0.33, 0, 0.01],
    [0.1, -0.015, 0.12],
    [0, -0.005, 0.075],
    [-0.1, -0.015, 0.12],
  ];
  const rim = outline.map(([x, y, z]): Vec3 => [x * span, y, z * chord]);
  for (let i = 0; i < rim.length; i++) {
    const a = rim[i],
      b = rim[(i + 1) % rim.length];
    wing.triangle([0, 0.045, 0], b, a, i % 2 ? P.mint : P.forestLight);
    wing.triangle([0, -0.018, 0], a, b, P.steel);
  }
  wing
    .beam(rim[0], [0, 0.045, 0], 0.004, P.steelShade)
    .beam([0, 0.045, 0], rim[4], 0.004, P.steelShade);
  return facilityModel(
    "airborne-wind",
    body,
    stage === undefined || stage === 3
      ? switchgear(body, size === "large" ? 0.168 : 0.14)
      : [],
    [
      {
        mesh: wing.build(),
        position: wingPosition,
        ...(stage === undefined && { motion: "sway" }),
        castsShadow: true,
      },
      windows(body, 0, 0.08, hallDepth / 2 + 0.003, hallWidth - 0.09),
    ],
  );
}

const gasLayouts = {
  small: {
    vents: [0.132],
    ventZ: -0.1,
    ventHeight: 0.218,
    skids: [-0.146],
    skidY: 0.09,
    skidZ: -0.022,
    radius: 0.047,
    length: 0.155,
    pipeX: -0.194,
    pipeZ: 0.124,
  },
  medium: {
    vents: [0.03, 0.19],
    ventZ: -0.1,
    ventHeight: 0.3,
    skids: [-0.24],
    skidY: 0.105,
    skidZ: 0.12,
    radius: 0.066,
    length: 0.22,
    pipeX: -0.3,
    pipeZ: -0.15,
  },
  large: {
    vents: [-0.018, 0.14, 0.298],
    ventZ: -0.154,
    ventHeight: 0.37,
    skids: [-0.296, -0.183],
    skidY: 0.105,
    skidZ: -0.057,
    radius: 0.051,
    length: 0.25,
    pipeX: -0.337,
    pipeZ: 0.181,
  },
} as const;

function gasSkid(radius: number, length: number): MapMesh {
  return new MeshBuilder()
    .cylinder([0, 0, 0], radius, radius, length, P.steel, 8)
    .build();
}

function gasConstruction(
  size: FacilitySize,
  stage: FacilityConstructionStage,
): MapModel {
  const body = new MeshBuilder(),
    small = size === "small",
    large = size === "large";
  const {
    vents,
    ventZ,
    ventHeight,
    skids,
    skidY,
    skidZ,
    radius,
    length,
    pipeX,
    pipeZ,
  } = gasLayouts[size];
  const hallX = small ? 0.055 : large ? 0.105 : 0.075,
    hallZ = large ? -0.015 : 0.015,
    width = small ? 0.245 : large ? 0.47 : 0.4,
    depth = small ? 0.2 : large ? 0.33 : 0.28,
    eave = small ? 0.135 : large ? 0.228 : 0.18,
    roofRise = small ? 0.032 : large ? 0.055 : 0.045;
  const left = hallX - width / 2,
    right = hallX + width / 2,
    back = hallZ - depth / 2,
    front = hallZ + depth / 2;
  base(
    body,
    small ? 0.46 : large ? 0.77 : 0.64,
    small ? 0.36 : large ? 0.51 : 0.4,
  );

  if (stage < 3) body.box([hallX, 0.045, hallZ], [width, 0.018, depth], P.rock);

  const skid = stage ? gasSkid(radius, length) : undefined;
  for (const [i, x] of skids.entries()) {
    if (size === "medium")
      body.box(
        [x, 0.018, skidZ + length / 2],
        [radius * 2.15, 0.036, length],
        P.rock,
      );
    const bearingBottom = size === "medium" || stage === 0;
    for (const z of [skidZ + 0.035, skidZ + length - 0.035])
      body.box(
        [x, bearingBottom ? 0.057 : 0.05, z],
        [
          radius * (stage === 0 ? 1.65 : 1.2),
          bearingBottom ? 0.044 : 0.03,
          0.032,
        ],
        P.steel,
      );
    if (skid && (stage >= 2 || i === 0))
      body.merge(skid, [x, skidY, skidZ], [Math.PI / 2, 0, 0]);
  }

  for (const [i, x] of vents.entries()) {
    if (stage < 2) {
      body.cylinder([x, 0.052, ventZ], 0.034, 0.034, 0.015, P.steel, 8);
      continue;
    }
    const fullHeight = stage === 3;
    body.cylinder(
      [x, 0.03, ventZ],
      0.022,
      0.01804,
      ventHeight * (fullHeight ? 1 : i === 0 ? 0.79 : 0.48),
      P.steelShade,
      8,
    );
    if (fullHeight)
      body.cylinder(
        [x, ventHeight - 0.005, ventZ],
        0.02266,
        0.02266,
        0.035,
        P.steel,
        8,
      );
  }

  if (stage === 1) {
    for (const z of [back, hallZ, front]) {
      body
        .box(
          [left, (eave + 0.05) / 2, z],
          [0.026, eave - 0.05, 0.026],
          P.steelShade,
        )
        .box(
          [right, (eave + 0.05) / 2, z],
          [0.026, eave - 0.05, 0.026],
          P.steelShade,
        )
        .beam([left, eave, z], [hallX, eave + roofRise, z], 0.012, P.steel)
        .beam([hallX, eave + roofRise, z], [right, eave, z], 0.012, P.steel);
    }
    body.beam(
      [hallX, eave + roofRise, back],
      [hallX, eave + roofRise, front],
      0.012,
      P.steelShade,
    );
  } else if (stage === 2) {
    const closedDepth = depth * 0.67;
    const closedCenter = back + closedDepth / 2;
    body.box(
      [hallX, (eave + 0.03) / 2, closedCenter],
      [width, eave - 0.03, closedDepth],
      P.cream,
    );
    gable(
      body,
      [hallX, eave, closedCenter],
      [width + 0.02, roofRise, closedDepth + 0.015],
      P.steel,
    );
    for (const x of [left, right])
      body
        .box(
          [x, (eave + 0.05) / 2, front],
          [0.026, eave - 0.05, 0.026],
          P.steelShade,
        )
        .beam([x, eave, back + closedDepth], [x, eave, front], 0.012, P.steel);
    body
      .beam(
        [left, eave, front],
        [hallX, eave + roofRise, front],
        0.012,
        P.steel,
      )
      .beam(
        [hallX, eave + roofRise, front],
        [right, eave, front],
        0.012,
        P.steel,
      );
  } else if (stage === 3) {
    body.box(
      [hallX, (eave + 0.03) / 2, hallZ],
      [width, eave - 0.03, depth],
      P.cream,
    );
    gable(
      body,
      [hallX, eave, hallZ],
      [width + 0.02, roofRise, depth + 0.02],
      P.steel,
    );

    // The capped fuel header stops at a test support before it reaches the hall.
    const capX = pipeX + (left - 0.015 - pipeX) * 0.35;
    body
      .beam([pipeX, 0.063, pipeZ], [capX, 0.063, pipeZ], 0.014, P.mint)
      .box([capX, 0.049, pipeZ], [0.032, 0.041, 0.035], P.earth);
    const glazing = windows(
      body,
      hallX + 0.005,
      small ? 0.082 : large ? 0.124 : 0.1,
      front + 0.004,
      small ? 0.17 : large ? 0.34 : 0.29,
    );
    return facilityModel("gas", body, switchgear(body, small ? 0.166 : 0.22), [
      glazing,
    ]);
  }

  return facilityModel("gas", body, []);
}

function thermal(
  kind: "gas" | "oil" | "coal" | "biomass",
  size: FacilitySize,
): MapModel {
  const body = new MeshBuilder(),
    moving: ModelPart[] = [];
  const small = size === "small",
    large = size === "large";
  base(
    body,
    small ? 0.46 : large ? 0.77 : 0.64,
    small ? 0.36 : large ? 0.51 : 0.4,
  );
  const hallX = small ? 0.055 : large ? 0.105 : 0.075,
    hallZ = large ? -0.015 : 0.015,
    width = small ? 0.245 : large ? 0.47 : 0.4,
    depth = small ? 0.2 : large ? 0.33 : 0.28,
    eave = small ? 0.135 : large ? 0.228 : 0.18;
  body.box(
    [hallX, (eave + 0.03) / 2, hallZ],
    [width, eave - 0.03, depth],
    P.cream,
  );
  gable(
    body,
    [hallX, eave, hallZ],
    [width + 0.02, small ? 0.032 : large ? 0.055 : 0.045, depth + 0.02],
    kind === "biomass" ? P.forest : P.steel,
  );
  moving.push(
    windows(
      body,
      hallX + 0.005,
      small ? 0.082 : large ? 0.124 : 0.1,
      hallZ + depth / 2 + 0.004,
      small ? 0.17 : large ? 0.34 : 0.29,
    ),
  );
  const stack = (x: number, z: number, height: number, radius = 0.027) => {
    body.cylinder([x, 0.03, z], radius, radius * 0.82, height, P.steelShade, 8);
    body.cylinder(
      [x, height - 0.005, z],
      radius * 1.03,
      radius * 1.03,
      0.035,
      P.steel,
      8,
    );
    moving.push(
      steam([x, height + 0.045, z]),
      steam([x, height + 0.045, z], 0.5),
    );
  };
  if (kind === "gas") {
    const {
      vents,
      ventZ,
      ventHeight,
      skids,
      skidY,
      skidZ,
      radius,
      length,
      pipeX,
      pipeZ,
    } = gasLayouts[size];
    for (const x of vents) stack(x, ventZ, ventHeight, 0.022);
    const skid = gasSkid(radius, length);
    for (const x of skids) {
      body.merge(skid, [x, skidY, skidZ], [Math.PI / 2, 0, 0]);
      if (small || large)
        for (const z of [skidZ + 0.035, skidZ + length - 0.035])
          body.box([x, 0.05, z], [radius * 1.2, 0.03, 0.024], P.steelShade);
    }
    body.beam(
      [pipeX, 0.06, pipeZ],
      [hallX - width / 2 - 0.015, 0.06, pipeZ],
      0.014,
      P.mint,
    );
  } else if (kind === "oil") {
    const radius = small ? 0.061 : large ? 0.075 : 0.08,
      height = small ? 0.117 : large ? 0.178 : 0.15;
    const tanks = {
      small: [[-0.145, 0.028]],
      medium: [
        [-0.23, -0.1],
        [-0.23, 0.09],
      ],
      large: [
        [-0.275, -0.169],
        [-0.21, 0.002],
        [-0.31, 0.154],
      ],
    }[size];
    for (const [tankX, z] of tanks) {
      body.cylinder([tankX, 0.036, z], radius, radius, height, P.cream, 8);
      body.cylinder(
        [tankX, 0.036 + height, z],
        radius + 0.001,
        radius * 0.3125,
        0.035,
        P.steel,
        8,
      );
      body.cylinder(
        [tankX, 0.085, z],
        radius + 0.001,
        radius + 0.001,
        0.013,
        P.steelShade,
        8,
      );
    }
    stack(
      small ? 0.132 : large ? 0.259 : 0.21,
      -0.11,
      small ? 0.266 : large ? 0.49 : 0.4,
    );
    if (large)
      body.beam(
        [-0.31, 0.075, 0.154],
        [-0.125, 0.075, 0.126],
        0.014,
        P.steelShade,
      );
  } else if (kind === "coal") {
    const {
      bunkerX,
      bunkerWidth,
      piles,
      pileLength,
      feed,
      discharge,
      chimneys,
    } = coalLayout(size);
    for (const z of piles) {
      body.box(
        [bunkerX, 0.075, z],
        [bunkerWidth, 0.08, pileLength],
        P.steelShade,
      );
      gable(
        body,
        [bunkerX, 0.115, z],
        [bunkerWidth - 0.03, 0.07, pileLength - 0.04],
        P.ink,
      );
    }
    body.beam(feed, discharge, large ? 0.033 : 0.022, P.steelShade);
    for (const [x, z, height] of chimneys) stack(x, z, height, 0.031);
  } else {
    const radius = small ? 0.059 : large ? 0.077 : 0.082;
    const silos = {
      small: [[-0.143, -0.024, 0.144]],
      medium: [[-0.225, -0.02, 0.23]],
      large: [
        [-0.304, -0.119, 0.305],
        [-0.217, 0.064, 0.25],
      ],
    }[size];
    for (const [siloX, z, height] of silos) {
      body.cylinder([siloX, 0.036, z], radius, radius, height, P.cream, 8);
      body.cylinder(
        [siloX, height + 0.036, z],
        radius + 0.005,
        0.02,
        small ? 0.048 : 0.06,
        P.forest,
        8,
      );
      for (const y of small ? [0.114] : [0.1, 0.21])
        body.cylinder(
          [siloX, y, z],
          radius + 0.002,
          radius + 0.002,
          0.01,
          P.steelShade,
          8,
        );
    }
    stack(
      small ? 0.138 : large ? 0.266 : 0.22,
      -0.11,
      small ? 0.246 : large ? 0.437 : 0.33,
    );
    body.box(
      [
        small ? -0.143 : large ? -0.243 : -0.19,
        0.06,
        small ? 0.12 : large ? 0.183 : 0.155,
      ],
      [
        small ? 0.127 : large ? 0.224 : 0.19,
        large ? 0.06 : 0.045,
        large ? 0.07 : 0.055,
      ],
      P.timber,
    );
  }
  return facilityModel(
    kind,
    body,
    switchgear(body, small ? 0.166 : 0.22),
    moving,
  );
}

function oilConstruction(
  size: FacilitySize,
  stage: FacilityConstructionStage,
): MapModel {
  const body = new MeshBuilder();
  const small = size === "small",
    large = size === "large",
    switchgearZ = small ? 0.166 : 0.22;
  if (stage === 3) {
    const finished = thermal("oil", size);
    body.merge(finished.parts[0].mesh);
    // An open service bay and hinged cover in front of the connected switchgear.
    const face = switchgearZ + switchgearDepth / 2;
    body
      .box([0.043, 0.065, face + 0.002], [0.084, 0.064, 0.004], P.ink)
      .box([0.106, 0.065, face + 0.024], [0.06, 0.066, 0.009], P.steelShade, [
        0,
        -Math.PI / 4,
        0,
      ]);
    for (const x of [0.021, 0.043, 0.065])
      body.box([x, 0.071, face + 0.007], [0.012, 0.032, 0.008], P.cream);
    return facilityModel(
      "oil",
      body,
      finished.terminals,
      finished.parts.filter(({ material }) => material === "facility-window"),
    );
  }

  base(
    body,
    small ? 0.46 : large ? 0.77 : 0.64,
    small ? 0.36 : large ? 0.51 : 0.4,
  );
  const hallX = small ? 0.055 : large ? 0.105 : 0.075,
    hallZ = large ? -0.015 : 0.015,
    width = small ? 0.245 : large ? 0.47 : 0.4,
    depth = small ? 0.2 : large ? 0.33 : 0.28,
    eave = small ? 0.135 : large ? 0.228 : 0.18,
    stackX = small ? 0.132 : large ? 0.259 : 0.21,
    stackHeight = small ? 0.266 : large ? 0.49 : 0.4;
  const tanks = (
    {
      small: [[-0.145, 0.028]],
      medium: [
        [-0.23, -0.1],
        [-0.23, 0.09],
      ],
      large: [
        [-0.275, -0.169],
        [-0.21, 0.002],
        [-0.31, 0.154],
      ],
    } as const
  )[size];
  const radius = small ? 0.061 : large ? 0.075 : 0.08,
    tankHeight = small ? 0.117 : large ? 0.178 : 0.15;
  if (stage < 2) body.box([hallX, 0.048, hallZ], [width, 0.024, depth], P.rock);
  for (const [x, z] of tanks) {
    if (stage < 2) {
      const footing = stage === 0 ? radius : radius - 0.014;
      body.cylinder([x, 0.036, z], footing, footing, 0.025, P.rock, 8);
    }
    if (stage === 1) {
      const outer = radius,
        inner = radius - 0.018,
        top = 0.036 + tankHeight * 0.73;
      const ring = (i: number, y: number, r: number): Vec3 => [
        x + r * Math.cos((i * TAU) / 8),
        y,
        z + r * Math.sin((i * TAU) / 8),
      ];
      for (let i = 0; i < 8; i++) {
        const j = i + 1;
        body
          .quad(
            ring(j, 0.036, outer),
            ring(i, 0.036, outer),
            ring(i, top, outer),
            ring(j, top, outer),
            P.cream,
          )
          .quad(
            ring(i, 0.061, inner),
            ring(j, 0.061, inner),
            ring(j, top, inner),
            ring(i, top, inner),
            P.steelShade,
          )
          .quad(
            ring(j, top, outer),
            ring(i, top, outer),
            ring(i, top, inner),
            ring(j, top, inner),
            P.steel,
          );
      }
    }
    if (stage === 2)
      body
        .cylinder([x, 0.036, z], radius, radius, tankHeight, P.cream, 8)
        .cylinder(
          [x, 0.036 + tankHeight, z],
          radius + 0.001,
          radius * 0.3125,
          0.035,
          P.steel,
          8,
        )
        .cylinder(
          [x, 0.085, z],
          radius + 0.001,
          radius + 0.001,
          0.013,
          P.steelShade,
          8,
        );
  }

  if (stage < 2)
    body.cylinder([stackX, 0.036, -0.11], 0.044, 0.044, 0.028, P.rockShade, 8);
  if (stage === 1) {
    const wall = eave * 0.79;
    body.box(
      [hallX, wall / 2 + 0.03, hallZ - depth / 2 + 0.014],
      [width, wall - 0.06, 0.028],
      P.cream,
    );
    for (const x of [
      hallX - width / 2 + 0.015,
      hallX,
      hallX + width / 2 - 0.015,
    ])
      for (const z of [hallZ - depth / 2 + 0.015, hallZ + depth / 2 - 0.015])
        body.box(
          [x, (wall + 0.06) / 2, z],
          [0.024, wall - 0.06, 0.024],
          P.steelShade,
        );
    body.box(
      [hallX, wall, hallZ + depth / 2 - 0.015],
      [width, 0.024, 0.024],
      P.steelShade,
    );
  }
  if (stage === 2) {
    body.box(
      [hallX, (eave + 0.03) / 2, hallZ],
      [width, eave - 0.03, depth],
      P.cream,
    );
    for (const z of [hallZ - depth * 0.38, hallZ, hallZ + depth * 0.38])
      body.box([hallX, eave, z], [width + 0.014, 0.024, 0.025], P.steelShade);
    body.cylinder(
      [stackX, 0.03, -0.11],
      0.027,
      0.023,
      stackHeight * 0.74,
      P.steelShade,
      8,
    );

    const [tankX, tankZ] = tanks[tanks.length - 1];
    const hallInletX = large ? -0.125 : hallX - width / 4,
      hallInletZ = large ? 0.126 : hallZ + depth / 2 - 0.004;
    const pipePoint = (t: number): Vec3 => [
      tankX + (hallInletX - tankX) * t,
      0.075,
      tankZ + (hallInletZ - tankZ) * t,
    ];
    const outlet = pipePoint(0.52),
      inlet = pipePoint(0.76);
    body
      .beam(pipePoint(0), outlet, 0.014, P.steelShade)
      .beam(inlet, pipePoint(1), 0.014, P.steelShade);
    for (const [x, , z] of [outlet, inlet])
      body.box([x, 0.055, z], [0.022, 0.038, 0.027], P.rockShade);
  }
  return facilityModel("oil", body, []);
}

function gasSteam(
  size: FacilitySize,
  stage?: FacilityConstructionStage,
): MapModel {
  const body = new MeshBuilder();
  const small = size === "small",
    large = size === "large";
  base(
    body,
    small ? 0.48 : large ? 0.77 : 0.64,
    small ? 0.36 : large ? 0.51 : 0.4,
  );

  // The high boiler and its overhead steam pipe remain distinct from the lower turbine hall.
  const boilerX = small ? -0.111 : large ? -0.196 : -0.15,
    boilerZ = small ? -0.026 : large ? -0.052 : -0.04,
    boilerWidth = small ? 0.197 : large ? 0.315 : 0.25,
    boilerDepth = small ? 0.198 : large ? 0.337 : 0.25,
    boilerHeight = small ? 0.19 : large ? 0.349 : 0.266,
    boilerEave = 0.036 + boilerHeight;
  const hallX = small ? 0.112 : large ? 0.144 : 0.13,
    hallZ = large ? 0.03 : 0.023,
    hallWidth = small ? 0.216 : large ? 0.417 : 0.31,
    hallDepth = small ? 0.192 : large ? 0.326 : 0.26,
    hallHeight = small ? 0.093 : large ? 0.194 : 0.136,
    hallEave = 0.036 + hallHeight;

  if (stage === 0) {
    // Independent boiler and turbine foundations remain readable on the common slab.
    body
      .box([boilerX, 0.051, boilerZ], [boilerWidth, 0.03, boilerDepth], P.rock)
      .box([hallX, 0.047, hallZ], [hallWidth, 0.022, hallDepth], P.steel);
    for (const z of [-0.29, 0.29]) {
      body.box(
        [hallX, 0.07, hallZ + z * hallDepth],
        [hallWidth * 0.78, 0.024, 0.028],
        P.rock,
      );
    }
    return facilityModel("gas-steam", body, []);
  }

  body.box(
    [boilerX, 0.036 + boilerHeight / 2, boilerZ],
    [boilerWidth, boilerHeight, boilerDepth],
    P.cream,
  );
  if (stage === 1) {
    const postSize = small ? 0.023 : 0.03;
    for (const side of [-1, 1]) {
      const x = hallX + (side * (hallWidth - postSize)) / 2;
      body.box(
        [x, hallEave - postSize / 2, hallZ],
        [postSize, postSize, hallDepth],
        P.steel,
      );
      for (const offset of [-1, 1]) {
        const z = hallZ + (offset * (hallDepth - postSize)) / 2;
        body.box(
          [x, 0.036 + hallHeight / 2, z],
          [postSize, hallHeight, postSize],
          P.steelShade,
        );
      }
    }
    for (const side of [-1, 1]) {
      body.box(
        [
          hallX,
          hallEave - postSize / 2,
          hallZ + (side * (hallDepth - postSize)) / 2,
        ],
        [hallWidth - 2 * postSize, postSize, postSize],
        P.steel,
      );
    }
    return facilityModel("gas-steam", body, []);
  }

  gable(
    body,
    [boilerX, boilerEave, boilerZ],
    [
      boilerWidth + 0.02,
      small ? 0.032 : large ? 0.053 : 0.041,
      boilerDepth + 0.02,
    ],
    P.steel,
  );
  body.box(
    [hallX, 0.036 + hallHeight / 2, hallZ],
    [hallWidth, hallHeight, hallDepth],
    P.cream,
  );
  gable(
    body,
    [hallX, hallEave, hallZ],
    [hallWidth + 0.02, small ? 0.027 : large ? 0.049 : 0.034, hallDepth + 0.02],
    P.steelShade,
  );
  const pipeZ = small ? -0.035 : large ? 0.052 : -0.07,
    pipeY = boilerEave - (small ? 0.036 : large ? 0.067 : 0.052),
    pipeX = hallX - 0.028,
    thickness = small ? 0.021 : large ? 0.037 : 0.027;
  const boilerOutlet = boilerX + boilerWidth / 2 - 0.001;
  const pipeGap = pipeX - boilerOutlet;
  body.beam(
    [boilerOutlet, pipeY, pipeZ],
    [stage === 2 ? boilerOutlet + pipeGap * 0.35 : pipeX, pipeY, pipeZ],
    thickness,
    P.steel,
    8,
  );
  body.beam(
    [pipeX, stage === 2 ? hallEave + (pipeY - hallEave) * 0.55 : pipeY, pipeZ],
    [pipeX, hallEave - 0.011, pipeZ],
    thickness,
    P.steel,
    8,
  );

  const doorY = small ? 0.072 : large ? 0.101 : 0.085,
    doorWidth = small ? 0.072 : large ? 0.129 : 0.098,
    doorHeight = small ? 0.072 : large ? 0.13 : 0.098,
    doorZ = boilerZ + boilerDepth / 2 + 0.007;
  if (stage === 3) {
    // Exposed busbars and the removed cover mark the remaining electrical work.
    body
      .box([boilerX, doorY, doorZ], [doorWidth, doorHeight, 0.016], P.ink)
      .box(
        [boilerX + doorWidth * 0.3, 0.044, doorZ + 0.049],
        [doorWidth, 0.016, doorHeight * 0.65],
        P.steelShade,
      );
    for (const side of [-1, 1]) {
      body.box(
        [boilerX + side * doorWidth * 0.2, doorY, doorZ + 0.01],
        [0.014, doorHeight * 0.72, 0.008],
        P.timber,
      );
    }
  } else if (stage === undefined) {
    body.box(
      [boilerX, doorY, doorZ],
      [doorWidth, doorHeight, 0.016],
      P.steelShade,
    );
  }

  const moving: ModelPart[] = [];
  const chimney = (x: number, z: number, outletY: number, radius: number) => {
    if (stage === 2) {
      body.cylinder(
        [x, 0.036, z],
        radius,
        radius - 0.006,
        (outletY - 0.036) * 0.65,
        P.steel,
        8,
      );
      return;
    }
    body
      .cylinder(
        [x, 0.036, z],
        radius,
        radius - 0.01,
        outletY - 0.036,
        P.steel,
        8,
      )
      .cylinder(
        [x, outletY - 0.03, z],
        radius - 0.003,
        radius - 0.003,
        0.03,
        P.steelShade,
        8,
      )
      .cylinder(
        [x, outletY, z],
        radius - 0.015,
        radius - 0.015,
        0.002,
        P.ink,
        8,
      );
    if (stage !== undefined) return;
    moving.push(
      steam([x, outletY + 0.012, z]),
      steam([x, outletY + 0.012, z], 0.5),
    );
  };
  chimney(
    small ? 0.193 : large ? 0.321 : 0.27,
    small ? 0.105 : 0.12,
    small ? 0.335 : large ? 0.55 : 0.473,
    small ? 0.032 : large ? 0.044 : 0.041,
  );
  if (large) chimney(0.26, -0.178, 0.483, 0.041);
  return facilityModel(
    "gas-steam",
    body,
    stage === 2 ? [] : switchgear(body, small ? 0.17 : 0.22),
    [
      windows(
        body,
        hallX,
        small ? 0.087 : large ? 0.135 : 0.113,
        hallZ + hallDepth / 2 + 0.004,
        small ? 0.152 : large ? 0.306 : 0.227,
      ),
      ...moving,
    ],
  );
}

function coalLayout(size: FacilitySize) {
  const small = size === "small",
    large = size === "large";
  const bunkerX = small ? -0.143 : large ? -0.25 : -0.225;
  const feed: Vec3 = [bunkerX + 0.005, 0.15, large ? 0.103 : 0.08],
    discharge: Vec3 = [
      small ? 0.02 : large ? 0.008 : -0.035,
      large ? 0.286 : small ? 0.159 : 0.22,
      0.02,
    ];
  const chimneys: Vec3[] = [
    [
      small ? 0.135 : large ? 0.29 : 0.21,
      -0.11,
      small ? 0.292 : large ? 0.55 : 0.43,
    ],
  ];
  if (large) chimneys.push([0.147, -0.145, 0.486]);
  return {
    bunkerX,
    bunkerWidth: small ? 0.105 : large ? 0.195 : 0.17,
    piles: small ? [0] : large ? [-0.123, 0.103] : [-0.025],
    pileLength: small ? 0.2 : large ? 0.195 : 0.29,
    feed,
    discharge,
    chimneys,
  };
}

function coalConstruction(
  size: FacilitySize,
  stage: FacilityConstructionStage,
): MapModel {
  const body = new MeshBuilder();
  const small = size === "small",
    large = size === "large";
  const { bunkerX, bunkerWidth, piles, pileLength, feed, discharge, chimneys } =
    coalLayout(size);
  const hallX = small ? 0.055 : large ? 0.105 : 0.075,
    hallZ = large ? -0.015 : 0.015,
    hallWidth = small ? 0.245 : large ? 0.47 : 0.4,
    hallDepth = small ? 0.2 : large ? 0.33 : 0.28,
    eave = small ? 0.135 : large ? 0.228 : 0.18;
  base(
    body,
    small ? 0.46 : large ? 0.77 : 0.64,
    small ? 0.36 : large ? 0.51 : 0.4,
  );
  body.box([hallX, 0.046, hallZ], [hallWidth, 0.02, hallDepth], P.rock);
  for (const [index, z] of piles.entries()) {
    body.box([bunkerX, 0.046, z], [bunkerWidth, 0.02, pileLength], P.rock);
    if (stage === 0) continue;
    const wall = 0.018;
    for (const side of [-1, 1]) {
      body.box(
        [bunkerX + (side * (bunkerWidth - wall)) / 2, 0.085, z],
        [wall, 0.06, pileLength],
        P.steelShade,
      );
      body.box(
        [bunkerX, 0.085, z + (side * (pileLength - wall)) / 2],
        [bunkerWidth - 2 * wall, 0.06, wall],
        P.steelShade,
      );
    }
    if (stage === 3 || (stage === 2 && index === 0)) {
      const length = stage === 2 ? pileLength * 0.58 : pileLength - 0.04;
      const pileZ = z - (stage === 2 ? pileLength * 0.11 : 0);
      body.box(
        [bunkerX, 0.078, pileZ],
        [bunkerWidth - 0.038, 0.044, length],
        P.ink,
      );
      gable(
        body,
        [bunkerX, 0.1, pileZ],
        [bunkerWidth - 0.038, stage === 2 ? 0.061 : 0.085, length],
        P.ink,
      );
    }
  }

  const intermediate: Vec3 = [
    (feed[0] + discharge[0]) / 2,
    (feed[1] + discharge[1]) / 2,
    (feed[2] + discharge[2]) / 2,
  ];
  const trackHalfWidth = large ? 0.023 : 0.018;
  for (const [x, y, z] of [feed, intermediate, discharge]) {
    body.box([x, 0.048, z], [0.052, 0.024, 0.05], P.rock);
    if (stage > 0) body.beam([x, 0.06, z], [x, y, z], 0.012, P.steelShade);
    if (stage === 1)
      body.beam(
        [x, y, z - trackHalfWidth],
        [x, y, z + trackHalfWidth],
        0.01,
        P.steelShade,
      );
  }
  if (stage === 1) {
    for (const side of [-1, 1]) {
      const offset = side * trackHalfWidth;
      body.beam(
        [feed[0], feed[1], feed[2] + offset],
        [discharge[0], discharge[1], discharge[2] + offset],
        0.009,
        P.steel,
      );
    }
  } else if (stage > 1) {
    body.beam(feed, discharge, large ? 0.033 : 0.022, P.steelShade);
    const top = stage === 2 ? eave * 0.72 : eave;
    body.box(
      [hallX, (top + 0.056) / 2, hallZ],
      [hallWidth, top - 0.056, hallDepth],
      P.cream,
    );
    if (stage === 3)
      gable(
        body,
        [hallX, eave, hallZ],
        [
          hallWidth + 0.02,
          small ? 0.032 : large ? 0.055 : 0.045,
          hallDepth + 0.02,
        ],
        P.steel,
      );
  }

  for (const [index, [x, z, height]] of chimneys.entries()) {
    body.cylinder([x, 0.036, z], 0.043, 0.04, 0.025, P.rock, 8);
    if (stage === 0) continue;
    const builtHeight =
      stage === 1
        ? height * 0.22
        : stage === 2
          ? height * (index ? 0.42 : 0.64)
          : height;
    body.cylinder(
      [x, stage === 3 ? 0.03 : 0.06, z],
      0.031,
      stage === 3 ? 0.031 * 0.82 : 0.03,
      builtHeight,
      P.steelShade,
      8,
    );
    if (stage === 3)
      body.cylinder(
        [x, height - 0.005, z],
        0.031 * 1.03,
        0.031 * 1.03,
        0.035,
        P.steel,
        8,
      );
  }

  if (stage !== 3) return facilityModel("coal", body, []);
  // The feeder cover is still on timber skids beside the test-ready switchgear.
  const boardZ = small ? 0.166 : 0.22;
  const coverX = small ? 0.184 : large ? 0.29 : 0.23,
    coverZ = small ? 0.148 : 0.181;
  for (const z of [coverZ - 0.014, coverZ + 0.014])
    body.box([coverX, 0.047, z], [0.074, 0.022, 0.012], P.timber);
  body.box([coverX, 0.064, coverZ], [0.087, 0.012, 0.044], P.steel);
  const glazing = windows(
    body,
    hallX + 0.005,
    small ? 0.082 : large ? 0.124 : 0.1,
    hallZ + hallDepth / 2 + 0.004,
    small ? 0.17 : large ? 0.34 : 0.29,
  );
  return facilityModel("coal", body, switchgear(body, boardZ), [glazing]);
}

function nuclear(
  size: FacilitySize,
  stage?: FacilityConstructionStage,
): MapModel {
  const body = new MeshBuilder();
  const site = {
    small: {
      pad: [0.46, 0.32],
      reactor: [0.114, -0.031],
      annex: [
        [0.074, 0.067, 0.093],
        [0.229, 0.081, 0.104],
      ],
      glazing: [0.075, 0.148, 0.145],
      switchgear: 0.172,
    },
    medium: {
      pad: [0.64, 0.4],
      reactor: [0.17, -0.04],
      annex: [
        [0.13, 0.075, 0.13],
        [0.32, 0.1, 0.13],
      ],
      glazing: [0.085, 0.198, 0.23],
      switchgear: 0.22,
    },
    large: {
      pad: [0.76, 0.46],
      reactor: [0.012, 0.048],
      annex: [
        [-0.104, 0.075, 0.158],
        [0.42, 0.1, 0.122],
      ],
      glazing: [0.085, 0.222, 0.3],
      switchgear: 0.246,
    },
  } as const;
  const layout = site[size];
  const [padWidth, padDepth] = layout.pad;
  base(body, padWidth, padDepth);

  type ShellRing = readonly [height: number, radius: number];
  function openShell(
    x: number,
    z: number,
    profile: readonly ShellRing[],
    thickness: number,
    color: RGB,
  ): void {
    const point = (side: number, y: number, r: number): Vec3 => {
      const angle = (side * TAU) / 10;
      return [x + Math.cos(angle) * r, y, z + Math.sin(angle) * r];
    };
    for (let ring = 0; ring < profile.length - 1; ring++) {
      const [low, lr] = profile[ring],
        [high, hr] = profile[ring + 1];
      for (let a = 0; a < 10; a++) {
        const b = a + 1;
        body
          .quad(
            point(b, low, lr),
            point(a, low, lr),
            point(a, high, hr),
            point(b, high, hr),
            color,
          )
          .quad(
            point(a, low, lr - thickness),
            point(b, low, lr - thickness),
            point(b, high, hr - thickness),
            point(a, high, hr - thickness),
            P.steelShade,
          );
        if (ring === profile.length - 2)
          body.quad(
            point(a, high, hr),
            point(a, high, hr - thickness),
            point(b, high, hr - thickness),
            point(b, high, hr),
            P.steel,
          );
      }
    }
  }

  function coolingTower(
    x: number,
    z: number,
    profile: readonly ShellRing[],
    throatRadius: number,
    throatHeight: number,
    phase = 0,
  ): ModelPart[] {
    if (stage === 0) {
      const [baseY, radius] = profile[0];
      openShell(x, z, [profile[0], [baseY + 0.023, radius]], 0.025, P.rock);
      return [];
    }
    if (stage === 1 || stage === 2) {
      openShell(x, z, profile.slice(0, stage + 1), 0.017, P.cream);
      return [];
    }

    const [crest, rim] = profile[profile.length - 1];
    const ringPoint = (angle: number, y: number, radius: number): Vec3 => [
      x + Math.cos(angle) * radius,
      y,
      z + Math.sin(angle) * radius,
    ];
    for (let ring = 0; ring < profile.length - 1; ring++)
      for (let side = 0; side < 10; side++) {
        const a = (side * TAU) / 10,
          b = ((side + 1) * TAU) / 10;
        const [low, lr] = profile[ring],
          [high, hr] = profile[ring + 1];
        body.quad(
          ringPoint(b, low, lr),
          ringPoint(a, low, lr),
          ringPoint(a, high, hr),
          ringPoint(b, high, hr),
          P.cream,
        );
      }
    body.cylinder(
      [x, throatHeight, z],
      throatRadius,
      throatRadius,
      0.006,
      P.ink,
      10,
    );
    for (let side = 0; side < 10; side++) {
      const a = (side * TAU) / 10,
        b = ((side + 1) * TAU) / 10;
      body.quad(
        ringPoint(a, crest, rim),
        ringPoint(a, crest, throatRadius),
        ringPoint(b, crest, throatRadius),
        ringPoint(b, crest, rim),
        P.steel,
      );
    }
    if (stage === 3) {
      if (phase === 0) {
        // An inspection bridge rests on the rim while the throat is tested.
        const bridgeZ = z + rim * 0.34;
        body.box(
          [x, crest + 0.006, bridgeZ],
          [rim * 1.88, 0.014, 0.034],
          P.timber,
        );
        const railZ = bridgeZ + 0.012;
        for (const side of [-1, 1])
          body.box(
            [x + side * rim * 0.77, crest + 0.026, railZ],
            [0.012, 0.04, 0.012],
            P.steelShade,
          );
        body.box(
          [x, crest + 0.044, railZ],
          [rim * 1.65, 0.012, 0.012],
          P.steelShade,
        );
      }
      return [];
    }
    return [
      steam([x, crest + 0.025, z], phase),
      steam([x, crest + 0.025, z], phase + 0.5),
    ];
  }

  const exhaust =
    size === "small"
      ? coolingTower(
          -0.112,
          -0.027,
          [
            [0.036, 0.097],
            [0.097, 0.071],
            [0.171, 0.052],
            [0.244, 0.076],
          ],
          0.06,
          0.221,
        )
      : size === "large"
        ? [
            ...coolingTower(
              -0.228,
              -0.081,
              [
                [0.036, 0.134],
                [0.142, 0.102],
                [0.291, 0.075],
                [0.432, 0.112],
              ],
              0.091,
              0.401,
            ),
            ...coolingTower(
              0.232,
              -0.087,
              [
                [0.036, 0.127],
                [0.131, 0.091],
                [0.249, 0.068],
                [0.386, 0.101],
              ],
              0.082,
              0.355,
              0.22,
            ),
          ]
        : coolingTower(
            -0.16,
            -0.035,
            [
              [0.036, 0.142],
              [0.125, 0.105],
              [0.24, 0.078],
              [0.365, 0.112],
            ],
            0.092,
            0.335,
          );

  // The containment roof stays visible between the cooling towers on the largest site.
  const [reactorX, reactorZ] = layout.reactor;
  const dome =
    size === "small"
      ? [
          [0.036, 0.082, 0.082, 0.085],
          [0.121, 0.082, 0.061, 0.047],
          [0.168, 0.061, 0.022, 0.024],
          [0.192, 0.022, 0, 0.008],
        ]
      : size === "large"
        ? [
            [0.036, 0.119, 0.119, 0.138],
            [0.174, 0.119, 0.092, 0.078],
            [0.252, 0.092, 0.035, 0.043],
            [0.295, 0.035, 0, 0.011],
          ]
        : [
            [0.036, 0.115, 0.115, 0.125],
            [0.161, 0.115, 0.089, 0.065],
            [0.226, 0.089, 0.035, 0.035],
            [0.261, 0.035, 0, 0.01],
          ];
  const [annexCenter, annexDimensions] = layout.annex;
  const [annexX, , annexZ] = annexCenter;
  if (stage === 0 || stage === 1 || stage === 2) {
    const [floor, wallRadius, , wallHeight] = dome[0];
    const profile: ShellRing[] = [
      [floor, wallRadius],
      [floor + (stage === 0 ? 0.023 : wallHeight), wallRadius],
    ];
    if (stage === 2) {
      const [spring, , roofRadius, roofHeight] = dome[1];
      profile.push([spring + roofHeight, roofRadius]);
    }
    openShell(
      reactorX,
      reactorZ,
      profile,
      0.022,
      stage === 0 ? P.rock : P.steel,
    );

    const [width, , depth] = annexDimensions;
    if (stage === 2) body.box(annexCenter, annexDimensions, P.cream);
    else body.box([annexX, 0.044, annexZ], [width, 0.016, depth], P.rock);
    if (stage === 1) {
      for (const sideX of [-1, 1])
        for (const sideZ of [-1, 1])
          body.box(
            [
              annexX + sideX * (width / 2 - 0.011),
              0.08,
              annexZ + sideZ * (depth / 2 - 0.011),
            ],
            [0.022, 0.058, 0.022],
            P.steelShade,
          );
      body.box(
        [annexX, 0.108, annexZ + depth / 2 - 0.011],
        [width, 0.022, 0.022],
        P.steelShade,
      );
    }
    return facilityModel("nuclear", body, []);
  }

  dome.forEach(([y, baseRadius, topRadius, height], ring) => {
    body.cylinder(
      [reactorX, y, reactorZ],
      baseRadius,
      topRadius,
      height,
      ring === 0 ? P.steel : P.cream,
      10,
    );
  });

  body.box(annexCenter, annexDimensions, P.cream);
  if (size === "large") {
    body.box([annexX, 0.127, annexZ], [0.428, 0.014, 0.13], P.steel);
    body.box([0.218, 0.084, 0.138], [0.121, 0.095, 0.128], P.steel);
    body.box([0.218, 0.135, 0.138], [0.143, 0.014, 0.14], P.steelShade);
  }
  const [windowY, windowZ, windowWidth] = layout.glazing;
  const glazing = windows(body, annexX, windowY, windowZ, windowWidth);
  return facilityModel("nuclear", body, switchgear(body, layout.switchgear), [
    glazing,
    ...exhaust,
  ]);
}

function reservoir(
  surface: MeshBuilder,
  waterLevelRange: NonNullable<ModelPart["waterLevelRange"]>,
): ModelPart {
  return {
    mesh: surface.build(),
    material: "water",
    waterLevelRange,
    castsShadow: false,
  };
}

function hydro(
  size: FacilitySize,
  stage?: FacilityConstructionStage,
): MapModel {
  const body = new MeshBuilder(),
    water = new MeshBuilder(),
    flow = new MeshBuilder();
  const layout = {
    small: {
      span: 0.22,
      crest: 0.225,
      bow: 0.085,
      front: 0.09,
      back: -0.183,
      baseDepth: 0.36,
    },
    medium: {
      span: 0.32,
      crest: 0.32,
      bow: 0.15,
      front: 0.12,
      back: -0.242,
      baseDepth: 0.45,
    },
    large: {
      span: 0.353,
      crest: 0.385,
      bow: 0.165,
      front: 0.143,
      back: -0.265,
      baseDepth: 0.49,
    },
  }[size];
  const { span, crest, bow, front, back, baseDepth } = layout;
  base(body, span * 2 + 0.06, baseDepth);

  // The fill range runs from the basin floor to just below the crest.
  const floor = 0.103 + (crest - 0.32) * 0.18;
  const basinBack = back + 0.014;
  const floorBack = back + 0.007;
  const floorFront = front - 0.095;
  const waterY = crest - 0.045;
  const dryGrading = stage === 0 || stage === 1;
  const bedY = stage === 0 ? 0.055 : stage === 1 ? 0.073 : floor;
  const bedDepth = dryGrading ? 0.05 : 0.08;
  body.box(
    [0, bedY - bedDepth / 2, (floorBack + floorFront) / 2],
    [span * 2 + 0.02, bedDepth, floorFront - floorBack],
    stage === undefined ? P.steelShade : P.earth,
  );
  const backHeight = stage === 0 ? 0.082 : stage === 1 ? crest * 0.55 : crest;
  body.box(
    [0, (backHeight + 0.014) / 2, back],
    [span * 2 + 0.05, backHeight - 0.03, 0.025],
    P.steel,
  );
  const damFace = (x: number) => front - bow * (x / span) ** 2;
  const panelCount = size === "large" ? 10 : size === "small" ? 6 : 8;
  // Adjacent pours rise at different rates, using the final downstream face as a guide.
  const pourHeight = (panel: number) =>
    stage === 0
      ? 0.088
      : stage === 1
        ? crest * (panel % 4 < 2 ? 0.66 : 0.47)
        : crest;
  const batter = (height: number) => 1 - (height - 0.035) / (crest - 0.035);
  const faceAt = (z: number, height: number) => z + 0.07 * batter(height);
  const backAt = (z: number, height: number) =>
    z - 0.065 - 0.015 * batter(height);
  for (let i = 0; i < panelCount; i++) {
    const x = -span + (i * 2 * span) / panelCount;
    const next = -span + ((i + 1) * 2 * span) / panelCount;
    const a = damFace(x),
      b = damFace(next),
      height = pourHeight(i);
    body
      .quad(
        [x, 0.035, a + 0.07],
        [next, 0.035, b + 0.07],
        [next, height, faceAt(b, height)],
        [x, height, faceAt(a, height)],
        i % 2 ? P.cream : P.steel,
      )
      .quad(
        [x, height, faceAt(a, height)],
        [next, height, faceAt(b, height)],
        [next, height, backAt(b, height)],
        [x, height, backAt(a, height)],
        dryGrading ? P.rock : P.cream,
      )
      .quad(
        [next, 0.035, b - 0.08],
        [x, 0.035, a - 0.08],
        [x, height, backAt(a, height)],
        [next, height, backAt(b, height)],
        P.steel,
      );
    if (i > 0 && pourHeight(i - 1) !== height) {
      const previous = pourHeight(i - 1);
      body.quad(
        [x, previous, faceAt(a, previous)],
        [x, height, faceAt(a, height)],
        [x, height, backAt(a, height)],
        [x, previous, backAt(a, previous)],
        P.rockShade,
      );
    }
    if (stage === undefined)
      water.quad(
        [x, waterY, basinBack],
        [x, waterY, a - 0.067],
        [next, waterY, b - 0.067],
        [next, waterY, basinBack],
        P.water,
      );
    if (!dryGrading)
      body.beam(
        [x, crest + 0.017, a - 0.012],
        [next, crest + 0.017, b - 0.012],
        0.01,
        P.steelShade,
      );
  }
  for (const x of [-span - 0.015, span + 0.015]) {
    const frontAnchor = size === "small" ? 0.084 : 0.085;
    const backAnchor = size === "small" ? -0.186 : back - 0.003;
    const anchorHeight = dryGrading
      ? Math.max(backHeight, pourHeight(x < 0 ? 0 : panelCount - 1))
      : crest;
    body.box(
      [x, anchorHeight / 2 + 0.01, (frontAnchor + backAnchor) / 2],
      [0.03, anchorHeight - 0.02, frontAnchor - backAnchor],
      P.cream,
    );
  }

  // Separate discharge lanes follow the slope of the downstream dam face.
  const spillways = size === "large" ? [-0.075, 0.095] : [0];
  const chuteHalfWidth = size === "medium" ? 0.067 : 0.05;
  for (const x of dryGrading ? [] : spillways) {
    const topY = crest - 0.014,
      bottomY = 0.055;
    const topZ = damFace(x) + 0.004,
      bottomZ = topZ + 0.075;
    const crestHalfWidth = chuteHalfWidth * (0.052 / 0.067);
    if (stage !== 2)
      body.quad(
        [x - chuteHalfWidth, bottomY, bottomZ],
        [x + chuteHalfWidth, bottomY, bottomZ],
        [x + crestHalfWidth, topY, topZ],
        [x - crestHalfWidth, topY, topZ],
        stage === 3 ? P.steelShade : P.deepWater,
      );
    for (const dx of [-chuteHalfWidth + 0.002, chuteHalfWidth - 0.002])
      body.beam(
        [x + dx, crest, topZ - 0.004],
        [x + dx * 1.15, 0.046, bottomZ + 0.006],
        0.011,
        stage === 2 ? P.rockShade : P.cream,
      );
    if (stage === undefined)
      for (const height of [0.065, 0.145, 0.215]) {
        const y = bottomY + (height * (topY - bottomY)) / 0.251;
        const z = topZ + ((topY - y) / (topY - bottomY)) * 0.075;
        flow.box(
          [x, y, z + 0.004],
          [chuteHalfWidth * (0.087 / 0.067), 0.008, 0.008],
          P.water,
        );
      }
    if (size === "large" && stage !== 2)
      body.box(
        [x, topY + 0.021, topZ + 0.008],
        [0.087, 0.025, 0.027],
        P.steelShade,
      );
    if (stage === 3) {
      // Temporary stoplogs close the dry lanes while the lift gates are tested.
      const stoplogY = topY - 0.05;
      const stoplogZ = topZ + (0.05 / (topY - bottomY)) * 0.075;
      body.box(
        [x, stoplogY, stoplogZ + 0.005],
        [crestHalfWidth * 1.9, 0.034, 0.023],
        P.timber,
      );
    }
  }
  const house = {
    small: {
      x: -0.151,
      z: 0.118,
      width: 0.121,
      depth: 0.104,
      height: 0.08,
      windowWidth: 0.077,
    },
    medium: {
      x: -0.22,
      z: 0.145,
      width: 0.17,
      depth: 0.14,
      height: 0.12,
      windowWidth: 0.11,
    },
    large: {
      x: -0.266,
      z: 0.158,
      width: 0.185,
      depth: 0.149,
      height: 0.15,
      windowWidth: 0.122,
    },
  }[size];
  if (dryGrading) {
    body.box(
      [house.x, 0.038, house.z],
      [house.width + 0.016, 0.038, house.depth + 0.012],
      P.rockShade,
    );
    if (stage === 1) {
      const frameHeight = house.height * 0.76;
      for (const z of [
        house.z - house.depth * 0.41,
        house.z + house.depth * 0.41,
      ]) {
        const halfSpan = house.width * 0.39;
        for (const x of [house.x - halfSpan, house.x + halfSpan])
          body.box(
            [x, 0.05 + frameHeight / 2, z],
            [0.022, frameHeight, 0.022],
            P.steel,
          );
        body.box(
          [house.x, 0.05 + frameHeight, z],
          [halfSpan * 2 + 0.022, 0.018, 0.022],
          P.steel,
        );
      }
    }
    return facilityModel("hydro", body, []);
  }
  body.box(
    [house.x, 0.024 + house.height / 2, house.z],
    [house.width, house.height, house.depth],
    P.cream,
  );
  gable(
    body,
    [house.x, 0.024 + house.height, house.z],
    [house.width + 0.02, 0.025, house.depth + 0.015],
    P.steel,
  );
  const glazing = windows(
    body,
    house.x,
    0.025 + house.height / 2,
    house.z + house.depth / 2 + 0.003,
    house.windowWidth,
  );
  if (stage === 2) return facilityModel("hydro", body, [], [glazing]);
  const terminals = switchgear(body, size === "small" ? 0.185 : 0.245);
  if (stage === 3) return facilityModel("hydro", body, terminals, [glazing]);
  return facilityModel("hydro", body, terminals, [
    glazing,
    reservoir(water, [floor - 0.002 - waterY, 0.021]),
    effect(flow.build(), "flow"),
  ]);
}

function geothermal(
  size: FacilitySize,
  stage?: FacilityConstructionStage,
): MapModel {
  const body = new MeshBuilder();
  const small = size === "small",
    large = size === "large";
  const site = {
    small: {
      pad: [0.459, 0.32],
      hall: [
        [0.066, 0.08, 0.025],
        [0.272, 0.09, 0.171],
      ],
      roof: [
        [0.066, 0.125, 0.025],
        [0.288, 0.027, 0.186],
      ],
      glazing: [0.078, 0.114, 0.178],
      switchgear: 0.181,
    },
    medium: {
      pad: [0.64, 0.4],
      hall: [
        [0.105, 0.09, 0.06],
        [0.38, 0.12, 0.24],
      ],
      roof: [
        [0.105, 0.15, 0.06],
        [0.4, 0.035, 0.26],
      ],
      glazing: [0.09, 0.183, 0.25],
      switchgear: 0.22,
    },
    large: {
      pad: [0.752, 0.46],
      hall: [
        [0.13, 0.11, -0.046],
        [0.39, 0.162, 0.246],
      ],
      roof: [
        [0.13, 0.191, -0.046],
        [0.413, 0.043, 0.265],
      ],
      glazing: [0.114, 0.08, 0.255],
      switchgear: 0.227,
    },
  } as const;
  const layout = site[size];
  const [padWidth, padDepth] = layout.pad;
  const [hallCenter, hallDimensions] = layout.hall;
  const [roofBase, roofDimensions] = layout.roof;
  const [windowY, windowZ, windowWidth] = layout.glazing;
  const wells = small
    ? [[-0.16, 0.067, 0.185]]
    : large
      ? [
          [-0.278, -0.128, 0.312],
          [-0.212, 0.022, 0.27],
          [-0.288, 0.166, 0.227],
        ]
      : [
          [-0.235, -0.09, 0.24],
          [-0.15, 0.1, 0.19],
        ];
  const pipeRadius = small ? 0.016 : large ? 0.022 : 0.019;
  const collarRadius = small ? 0.027 : 0.035;
  base(body, padWidth, padDepth);
  if (stage === 0 || stage === 1) {
    const trenchX = small ? -0.079 : large ? -0.11 : -0.068;
    const trenchLength = padDepth * (stage === 0 ? 0.56 : 0.73);
    const trenchZ = stage === 0 ? -padDepth * 0.085 : 0;
    body.box([trenchX, 0.039, trenchZ], [0.057, 0.006, trenchLength], P.ink);
    for (const x of [trenchX - 0.04, trenchX + 0.04])
      body.box([x, 0.047, trenchZ], [0.023, 0.022, trenchLength], P.earthShade);

    const [hallX, , hallZ] = hallCenter;
    const [width, , depth] = hallDimensions;
    const footingY = 0.059;
    body.box([hallX, 0.046, hallZ], [width, 0.026, depth], P.rock);
    for (const [x, z, height] of wells) {
      body
        .cylinder([x, 0.035, z], collarRadius, collarRadius, 0.025, P.ink)
        .cylinder(
          [x, 0.06, z],
          collarRadius * 0.82,
          collarRadius * 0.82,
          0.012,
          P.rock,
        );
      if (stage === 1)
        body.cylinder(
          [x, 0.072, z],
          pipeRadius,
          pipeRadius,
          height * 0.59 - 0.072,
          P.steel,
          6,
        );
    }

    if (stage === 1) {
      const frameTop = roofBase[1] - 0.008;
      const left = hallX - width * 0.43,
        right = hallX + width * 0.43,
        back = hallZ - depth * 0.42,
        front = hallZ + depth * 0.42;
      for (const x of large ? [left, hallX, right] : [left, right])
        for (const z of [back, front])
          body.box(
            [x, (footingY + frameTop) / 2, z],
            [0.024, frameTop - footingY, 0.024],
            P.steelShade,
          );
      for (const z of [back, front])
        body.box(
          [hallX, frameTop, z],
          [width * 0.88, 0.021, 0.022],
          P.steelShade,
        );
      for (const x of [left, right])
        body.box(
          [x, frameTop, hallZ],
          [0.022, 0.021, depth * 0.84],
          P.steelShade,
        );
    }
    return facilityModel("geothermal", body, []);
  }

  body.box(hallCenter, hallDimensions, P.cream);
  gable(body, roofBase, roofDimensions, P.steel);
  const glazing = windows(body, hallCenter[0], windowY, windowZ, windowWidth);
  for (const [x, z, height] of wells) {
    const returnX = large ? -0.11 : x + (small ? 0.081 : 0.1);
    const returnY = small ? 0.09 : large ? 0.145 : 0.13;
    body.cylinder([x, 0.035, z], collarRadius, collarRadius, 0.025, P.ink);
    body.beam([x, 0.045, z], [x, height, z], pipeRadius, P.steel, 6);
    if (stage === 2) {
      const capX = x + (returnX - x) * 0.58;
      const capWidth = pipeRadius * 2.4;
      body
        .beam([x, height, z], [capX, height, z], pipeRadius, P.steel, 6)
        .box([capX, height, z], [0.012, capWidth, capWidth], P.timber)
        .box([capX, 0.048, z], [0.032, 0.024, 0.043], P.rockShade)
        .box(
          [capX, (height - pipeRadius + 0.06) / 2, z],
          [0.017, height - pipeRadius - 0.06, 0.021],
          P.steelShade,
        );
      continue;
    }
    body.beam([x, height, z], [returnX, height, z], pipeRadius, P.steel, 6);
    body.beam(
      [returnX, height, z],
      [returnX, returnY, z],
      pipeRadius,
      P.steel,
      6,
    );
    body.box([x, height - 0.045, z], [0.05, 0.012, 0.05], P.mint);
  }
  if (large && stage !== 2) {
    // Three doglegs feed a common header connected to the process hall.
    body
      .beam(
        [-0.11, 0.145, -0.151],
        [-0.11, 0.145, 0.184],
        0.024,
        P.steelShade,
        6,
      )
      .beam([-0.11, 0.145, 0.02], [0.06, 0.145, 0.02], 0.024, P.steel, 6)
      .box([-0.11, 0.145, 0.093], [0.061, 0.061, 0.018], P.mint)
      .cylinder([0.254, 0.036, 0.149], 0.061, 0.061, 0.129, P.steel, 8)
      .cylinder([0.254, 0.165, 0.149], 0.061, 0.035, 0.027, P.cream, 8)
      .beam(
        [0.254, 0.171, 0.149],
        [0.254, 0.171, 0.049],
        0.018,
        P.steelShade,
        6,
      );
  } else if (small && stage !== 2) {
    body.beam([-0.079, 0.09, 0.067], [-0.054, 0.09, 0.067], 0.016, P.steel, 6);
  }

  const vents = small
    ? [[0.136, 0.113, -0.046, 0.107, 0.238]]
    : large
      ? [
          [0.108, 0.191, -0.132, 0.173, 0.384],
          [0.271, 0.191, -0.102, 0.126, 0.339],
        ]
      : [[0.2, 0.15, -0.075, 0.14, 0.31]];
  const exhaust: ModelPart[] = [];
  for (const [x, y, z, height, outlet] of vents) {
    const radius = small ? 0.019 : large ? 0.028 : 0.025;
    body.cylinder(
      [x, y, z],
      radius,
      radius,
      stage === 2 ? height * 0.48 : height,
      P.steel,
      6,
    );
    if (stage === undefined)
      exhaust.push(steam([x, outlet, z]), steam([x, outlet, z], 0.5));
  }
  if (stage === 2) return facilityModel("geothermal", body, [], [glazing]);
  if (stage === 3) {
    const accessFace = layout.switchgear + switchgearDepth / 2;
    // The connected switchgear still has an open service bay and a swung cover.
    body
      .box([0.018, 0.064, accessFace + 0.003], [0.092, 0.059, 0.006], P.ink)
      .box(
        [0.086, 0.064, accessFace + 0.025],
        [0.078, 0.061, 0.008],
        P.steelShade,
        [0, -Math.PI / 4, 0],
      );
    for (const x of [-0.009, 0.018, 0.045])
      body.box([x, 0.066, accessFace + 0.008], [0.01, 0.034, 0.007], P.earth);
  }
  return facilityModel(
    "geothermal",
    body,
    switchgear(body, layout.switchgear),
    [glazing, ...exhaust],
  );
}

const batteryCabinets = {
  small: [[0, -0.02, 0.17, 0.18, 0.206]],
  medium: [
    [-0.16, 0, 0.21, 0.26, 0.27],
    [0.16, 0, 0.21, 0.26, 0.27],
  ],
  large: [
    [-0.235, -0.119, 0.201, 0.201, 0.32],
    [0.235, -0.119, 0.201, 0.201, 0.32],
    [-0.139, 0.108, 0.201, 0.201, 0.253],
    [0.139, 0.108, 0.201, 0.201, 0.253],
  ],
} as const;

type BatteryCabinet = readonly [
  x: number,
  z: number,
  width: number,
  depth: number,
  height: number,
];

function batteryCabinet(
  body: MeshBuilder,
  size: FacilitySize,
  [x, z, width, depth, height]: BatteryCabinet,
  flow?: MeshBuilder,
): void {
  const face = z + depth / 2;
  const indicatorY = 0.19 + (height - 0.27) * 0.6;
  const panelWidth = width * 0.5;
  const panelHeight = size === "small" ? 0.069 : 0.1;
  body.box([x, 0.035 + height / 2, z], [width, height, depth], P.cream);
  const cap = size === "small" ? 0.097 : 0.13;
  body.box([x, 0.042 + height, z], [cap, 0.016, cap], P.steelShade);
  body.box(
    [x, indicatorY, face + 0.003],
    [panelWidth, panelHeight, 0.006],
    flow ? P.mint : P.ink,
  );
  for (const y of [0.085, 0.105])
    body.box([x, y, face + 0.004], [width - 0.09, 0.006, 0.007], P.steelShade);
  flow?.box(
    [x, indicatorY, face + 0.009],
    [panelWidth * (2 / 3), 0.008, 0.005],
    P.cream,
  );
}

function batteryConstruction(
  size: FacilitySize,
  stage: FacilityConstructionStage,
): MapModel {
  const body = new MeshBuilder();
  const gearZ = size === "small" ? 0.152 : 0.22;
  if (size === "small") base(body, 0.35, 0.28);
  else if (size === "large") base(body, 0.76, 0.49);
  else base(body);

  const cabinets = batteryCabinets[size];
  const openBays = size === "large" ? 2 : 1;
  for (const [index, cabinet] of cabinets.entries()) {
    if (stage === 3 || (stage === 2 && index < cabinets.length - openBays)) {
      batteryCabinet(body, size, cabinet);
      continue;
    }
    const [x, z, width, depth, height] = cabinet;
    body.box([x, 0.046, z], [width, 0.022, depth], P.rock);
    if (stage === 0) {
      const aisle = z + depth / 2 + 0.015;
      body.box([x, 0.042, aisle], [width, 0.012, 0.02], P.steelShade);
      body.box([x, 0.045, z], [0.021, 0.015, depth], P.steelShade);
      continue;
    }
    const thickness = 0.016;
    const top = 0.035 + height;
    const sides = [x - (width - thickness) / 2, x + (width - thickness) / 2];
    const ends = [z - (depth - thickness) / 2, z + (depth - thickness) / 2];
    for (const side of sides) {
      for (const end of ends)
        body.box(
          [side, (top + 0.057) / 2, end],
          [thickness, top - 0.057, thickness],
          P.steelShade,
        );
      body.box([side, top, z], [thickness, thickness, depth], P.steel);
    }
    for (const end of ends)
      body.box(
        [x, top, end],
        [width - thickness * 2, thickness, thickness],
        P.steel,
      );

    for (const y of [0.094, 0.094 + height * 0.32]) {
      body.box(
        [x, y, z],
        [width - 0.024, 0.012, depth - thickness],
        P.steelShade,
      );
      if (stage === 2)
        body.box(
          [x, y + 0.024, z],
          [width - 0.038, 0.036, depth * 0.62],
          P.ink,
        );
    }
  }

  if (stage < 3) return facilityModel("battery", body, []);

  const terminals = switchgear(body, gearZ);
  // The busbars are fitted, but the service cover is propped open.
  const face = gearZ + switchgearDepth / 2;
  body.box([0, 0.065, face + 0.002], [0.157, 0.062, 0.006], P.ink);
  for (const y of [0.052, 0.075])
    body.box([0, y, face + 0.007], [0.12, 0.009, 0.009], P.cream);
  body.box([0.085, 0.065, face + 0.022], [0.078, 0.064, 0.009], P.steelShade, [
    0,
    Math.PI / 6,
    0,
  ]);
  return facilityModel("battery", body, terminals);
}

function storage(kind: "battery" | "iron-air", size: FacilitySize): MapModel {
  const body = new MeshBuilder(),
    flow = new MeshBuilder();
  if (size === "small") base(body, kind === "battery" ? 0.35 : 0.41, 0.28);
  else if (size === "large") base(body, 0.76, kind === "battery" ? 0.49 : 0.45);
  else base(body);

  if (kind === "battery") {
    for (const cabinet of batteryCabinets[size])
      batteryCabinet(body, size, cabinet, flow);
  } else {
    for (const { x, width, depth, height, fans, slats } of ironAirLayouts[
      size
    ]) {
      const face = depth / 2;
      const louverY = 0.07 + height / 2;
      const louverHeight = size === "small" ? 0.071 : 0.095;
      body.box([x, 0.035 + height / 2, 0], [width, height, depth], P.cream);
      body.box(
        [x, 0.049 + height, 0],
        [width + 0.03, 0.03, depth + 0.03],
        P.steel,
      );
      body.box(
        [x, louverY, face + 0.003],
        [width - 0.1, louverHeight, 0.007],
        P.steelShade,
      );
      const slatSpacing = (width - 0.16) / (slats - 1);
      for (let i = 0; i < slats; i++)
        body.box(
          [x + (i - (slats - 1) / 2) * slatSpacing, louverY, face + 0.01],
          [0.013, louverHeight, 0.008],
          P.steel,
        );
      const fanRadius =
        size === "small" ? 0.044 : size === "medium" ? 0.055 : 0.079;
      for (const offset of fans) {
        const fanX = x + offset;
        body.cylinder(
          [fanX, 0.065 + height, 0],
          fanRadius,
          fanRadius,
          0.006,
          P.steelShade,
          8,
        );
        const fanBlade = fanRadius * (0.04 / 0.055);
        body.beam(
          [fanX - fanBlade, 0.072 + height, 0],
          [fanX + fanBlade, 0.072 + height, 0],
          0.005,
          P.steel,
        );
        if (size === "large")
          body.beam(
            [fanX, 0.072 + height, -fanBlade],
            [fanX, 0.072 + height, fanBlade],
            0.005,
            P.steel,
          );
        body.box([fanX, 0.085, face + 0.005], [0.12, 0.045, 0.007], P.mint);
        flow.box([fanX, 0.085, face + 0.012], [0.075, 0.008, 0.005], P.cream);
      }
    }
  }
  return facilityModel(
    kind,
    body,
    switchgear(body, size === "small" ? 0.152 : 0.22),
    [effect(flow.build(), "flow")],
  );
}

const ironAirLayouts = {
  small: [
    { x: 0, width: 0.34, depth: 0.235, height: 0.17, fans: [0], slats: 4 },
  ],
  medium: [
    {
      x: 0,
      width: 0.58,
      depth: 0.29,
      height: 0.23,
      fans: [-0.15, 0.15],
      slats: 7,
    },
  ],
  large: [
    {
      x: -0.181,
      width: 0.321,
      depth: 0.31,
      height: 0.305,
      fans: [0],
      slats: 4,
    },
    {
      x: 0.181,
      width: 0.321,
      depth: 0.31,
      height: 0.27,
      fans: [0],
      slats: 4,
    },
  ],
};

function ironAirConstruction(
  size: FacilitySize,
  stage: FacilityConstructionStage,
): MapModel {
  const body = new MeshBuilder();
  if (size === "small") base(body, 0.41, 0.28);
  else if (size === "large") base(body, 0.76, 0.45);
  else base(body);

  const small = size === "small";
  const fanRadius = small ? 0.044 : size === "medium" ? 0.055 : 0.079;
  for (const [unit, { x, width, depth, height, fans, slats }] of ironAirLayouts[
    size
  ].entries()) {
    const face = depth / 2;
    // The upper intake and lower exhaust ducts will land on these two plinth lines.
    for (const z of [-face + 0.025, face - 0.025])
      body.box([x, 0.049, z], [width, 0.026, 0.055], P.rock);
    if (stage === 0) {
      for (const side of [-1, 1])
        body.box(
          [x + side * (width / 2 - 0.028), 0.052, 0],
          [0.044, 0.032, depth - 0.06],
          P.steelShade,
        );
      continue;
    }

    const floor = 0.06;
    const wallHeight = stage === 1 ? height * 0.67 : height - 0.025;
    const wallY = floor + wallHeight / 2;
    const rim = floor + wallHeight;
    const post = 0.025;
    for (const side of [-1, 1]) {
      const edge = x + (side * (width - post)) / 2;
      for (const z of [-face + post / 2, face - post / 2])
        body.box([edge, wallY, z], [post, wallHeight, post], P.steelShade);
      const sideHeight = stage === 1 ? wallHeight * 0.52 : wallHeight;
      body.box(
        [edge, floor + sideHeight / 2, 0],
        [0.021, sideHeight, depth - post * 2],
        P.cream,
      );
    }
    body
      .box(
        [x, wallY, -face + post / 2],
        [width - post * 2, wallHeight, post],
        P.cream,
      )
      .box([x, 0.072, 0], [width - 0.04, 0.025, depth - 0.04], P.steelShade)
      .box(
        [x, 0.093, -face * 0.45],
        [width - 0.075, 0.036, face * 0.72],
        P.ink,
      );
    if (stage === 1) {
      body.box(
        [x, rim - post / 2, face - post / 2],
        [width - post * 2, post, post],
        P.steelShade,
      );
      continue;
    }

    // The open slot below the louvers exposes the unfinished lower access panel.
    const louverY = 0.07 + height / 2;
    const louverHeight = small ? 0.071 : 0.095;
    body
      .box(
        [x, louverY, face - 0.025],
        [width - 0.052, louverHeight, 0.021],
        P.ink,
      )
      .box(
        [x, rim - post / 2, face - post / 2],
        [width - post * 2, post, post],
        P.cream,
      )
      .box(
        [x, louverY - louverHeight / 2, face - 0.013],
        [width - post * 2, 0.014, 0.023],
        P.steelShade,
      );
    const slatSpacing = (width - 0.16) / (slats - 1);
    for (let i = 0; i < slats; i++) {
      const slatX = x + (i - (slats - 1) / 2) * slatSpacing;
      body.box(
        [slatX, louverY, face + 0.002],
        [0.015, louverHeight, 0.011],
        P.steel,
      );
    }

    // Bridge the fan wells with transverse roof panels, leaving any unfitted well open.
    const roofY = 0.049 + height;
    const opening = fanRadius + 0.007;
    const roofFront = face + 0.015;
    for (const side of [-1, 1])
      body.box(
        [x, roofY, (side * (roofFront + opening)) / 2],
        [width + 0.03, 0.03, roofFront - opening],
        P.steel,
      );
    let roofEdge = x - width / 2 - 0.015;
    for (const offset of fans) {
      const fanX = x + offset;
      const nextEdge = fanX - opening;
      body
        .box(
          [(roofEdge + nextEdge) / 2, roofY, 0],
          [nextEdge - roofEdge, 0.03, 2 * opening],
          P.steel,
        )
        .box(
          [fanX, roofY - 0.025, 0],
          [2 * opening, 0.018, 0.028],
          P.steelShade,
        );
      roofEdge = fanX + opening;
      // The single-fan model stays fanless until commissioning. Pair installs begin on the left.
      if (stage === 2 && (small || unit > 0 || offset > 0)) continue;
      body
        .cylinder(
          [fanX, roofY + 0.014, 0],
          opening + 0.009,
          opening + 0.009,
          0.008,
          P.steelShade,
          8,
        )
        .beam(
          [fanX - fanRadius * 0.72, roofY + 0.022, 0],
          [fanX + fanRadius * 0.72, roofY + 0.022, 0],
          0.005,
          P.steel,
        );
      if (size === "large")
        body.beam(
          [fanX, roofY + 0.022, -fanRadius * 0.72],
          [fanX, roofY + 0.022, fanRadius * 0.72],
          0.005,
          P.steel,
        );
    }
    const right = x + width / 2 + 0.015;
    body.box(
      [(roofEdge + right) / 2, roofY, 0],
      [right - roofEdge, 0.03, 2 * opening],
      P.steel,
    );

    if (stage === 3) {
      // The replacement hatch is leaning against the face, beside the exposed access slot.
      const hatchWidth = width * 0.29;
      body.box(
        [x - width * 0.28, 0.077, face + 0.013],
        [hatchWidth, 0.086, 0.012],
        P.cream,
        [-0.21, 0, 0],
      );
    }
  }
  return facilityModel(
    "iron-air",
    body,
    stage === 3 ? switchgear(body, small ? 0.152 : 0.22) : [],
  );
}

function pumpedHydro(
  size: FacilitySize,
  stage?: FacilityConstructionStage,
): MapModel {
  const body = new MeshBuilder();
  const layout = {
    small: {
      base: [0.46, 0.38],
      upper: [-0.103, -0.086, 0.179, 0.245, 0.156],
      lower: [0.111, 0.105, 0.066, 0.213, 0.146],
      pipe: [
        [0.027, 0.154, -0.086],
        [0.07, 0.154, -0.086],
        [0.07, 0.076, 0.032],
        [-0.065, 0.076, 0.086],
      ],
      indicators: [
        [0.047, 0.154, -0.086],
        [0.07, 0.115, -0.027],
        [0.005, 0.076, 0.058],
      ],
      house: [-0.14, 0.104, 0.151, 0.111, 0.087, 0.094],
    },
    medium: {
      base: [0.66, 0.45],
      upper: [-0.13, -0.105, 0.26, 0.33, 0.2],
      lower: [0.17, 0.13, 0.075, 0.26, 0.17],
      pipe: [
        [0.048, 0.22, -0.1],
        [0.105, 0.22, -0.1],
        [0.105, 0.09, 0.035],
        [-0.1, 0.09, 0.11],
      ],
      indicators: [
        [0.07, 0.22, -0.1],
        [0.105, 0.15, -0.03],
        [0, 0.09, 0.07],
      ],
      house: [-0.19, 0.13, 0.21, 0.15, 0.12, 0.14],
    },
    large: {
      base: [0.76, 0.5],
      upper: [-0.135, -0.122, 0.335, 0.421, 0.224],
      lower: [0.17, 0.145, 0.1, 0.339, 0.217],
      pipe: [
        [0.084, 0.278, -0.115],
        [0.158, 0.278, -0.115],
        [0.082, 0.116, 0.025],
        [-0.093, 0.116, 0.109],
      ],
      indicators: [
        [0.123, 0.278, -0.115],
        [0.12, 0.197, -0.045],
        [-0.006, 0.116, 0.067],
      ],
      house: [-0.209, 0.148, 0.246, 0.172, 0.16, 0.163],
    },
  } as const;
  const site = layout[size];
  base(body, site.base[0], site.base[1]);
  const basin = (
    [x, z, top, width, depth]: readonly [
      number,
      number,
      number,
      number,
      number,
    ],
    upper: boolean,
  ) => {
    const bottom = Math.max(0.037, top * 0.24);
    body.box(
      [x, bottom / 2, z],
      [width, bottom, depth],
      stage === undefined ? P.steelShade : P.rock,
    );
    if (stage === 0) return undefined;

    const wallHeight = stage === 1 ? top * 0.62 + 0.018 : top + 0.03;
    const wallCenter = stage === 1 ? wallHeight / 2 : top / 2 + 0.015;
    for (const sign of [-1, 1]) {
      body.box(
        [x + (sign * width) / 2, wallCenter, z],
        [0.025, wallHeight, depth + 0.025],
        P.cream,
      );
      body.box(
        [x, wallCenter, z + (sign * depth) / 2],
        [width, wallHeight, 0.025],
        P.cream,
      );
    }
    if (size === "large" && upper)
      for (const sign of [-1, 1])
        body.box(
          [x + (sign * width) / 2, top * 0.22, z],
          [0.057, top * 0.44, depth + 0.022],
          P.steel,
        );
    if (stage === 3 && upper) {
      // A removable pressure-test walkway seats across the dry upper basin.
      const walkZ = z + depth / 4;
      body.box(
        [x, wallHeight + 0.008, walkZ],
        [width + 0.028, 0.016, 0.044],
        P.timber,
      );
      for (const xPost of [x - width / 2, x + width / 2])
        body.box(
          [xPost, wallHeight + 0.034, walkZ],
          [0.012, 0.042, 0.012],
          P.steelShade,
        );
      body.box(
        [x, wallHeight + 0.054, walkZ],
        [width + 0.014, 0.012, 0.012],
        P.steelShade,
      );
    }
    if (stage !== undefined) return undefined;

    const left = x - width / 2 + 0.011;
    const right = x + width / 2 - 0.011;
    const back = z - depth / 2 + 0.011;
    const front = z + depth / 2 - 0.011;
    const water = new MeshBuilder().quad(
      [left, top, back],
      [left, top, front],
      [right, top, front],
      [right, top, back],
      P.water,
    );
    // Stored energy tracks the upper basin. The lower basin declines as the upper fills.
    const empty = bottom - top - 0.001;
    const full = 0.01;
    return reservoir(water, upper ? [empty, full] : [full, empty]);
  };
  const upper = basin(site.upper, true);
  const lower = basin(site.lower, false);
  const [x, z, width, depth, height, windowWidth] = site.house;
  if (stage !== undefined) {
    const anchorWidth = size === "large" ? 0.079 : 0.046;
    const laneCenter = size === "large" ? 0.023 : 0;
    for (const [pipeX, pipeY, pipeZ] of [site.pipe[1], site.pipe[2]]) {
      body.box(
        [pipeX, 0.044, pipeZ + laneCenter],
        [0.05, 0.016, anchorWidth],
        P.rock,
      );
      if (stage >= 2) {
        const saddleTop = pipeY - 0.009;
        body.box(
          [pipeX, (saddleTop + 0.052) / 2, pipeZ + laneCenter],
          [0.024, saddleTop - 0.052, anchorWidth * 0.88],
          P.timber,
        );
      }
    }
    if (stage < 2) {
      body.box([x, 0.048, z], [width, 0.024, depth], P.rock);
      return facilityModel("pumped-hydro", body, []);
    }
  }

  const segments = stage === 2 ? 2 : site.pipe.length - 1;
  for (let i = 0; i < segments; i++) {
    const a = site.pipe[i];
    const b = site.pipe[i + 1];
    body.beam(a, b, size === "small" ? 0.016 : 0.022, P.steel, 8);
    if (size === "large")
      body.beam(
        [a[0], a[1], a[2] + 0.046],
        [b[0], b[1], b[2] + 0.046],
        0.017,
        P.steelShade,
        8,
      );
  }
  body.box([x, 0.017 + height / 2, z], [width, height, depth], P.cream);
  const eave = 0.017 + height;
  if (stage === 2) {
    gable(
      body,
      [x, eave, z - depth / 4],
      [width + 0.02, 0.025, depth / 2 + 0.02],
      P.steel,
    );
    body.box([x, eave, z + depth * 0.4], [width, 0.014, 0.017], P.steelShade);
    return facilityModel("pumped-hydro", body, []);
  }
  gable(body, [x, eave, z], [width + 0.02, 0.025, depth + 0.02], P.steel);
  const glazing = windows(
    body,
    x,
    0.025 + height / 2,
    z + depth / 2 + 0.003,
    windowWidth,
  );
  const terminals = switchgear(body, size === "small" ? 0.19 : 0.245);
  if (!upper || !lower)
    return facilityModel("pumped-hydro", body, terminals, [glazing]);

  const flow = new MeshBuilder();
  for (const [x, y, z] of site.indicators)
    flow.box([x, y, z], [0.02, 0.025, 0.02], P.mint);
  return facilityModel("pumped-hydro", body, terminals, [
    glazing,
    upper,
    lower,
    effect(flow.build(), "flow"),
  ]);
}

const citySizes = {
  "city-small": "small",
  "city-medium": "medium",
  "city-large": "large",
} as const satisfies Record<`city-${CitySizeType}`, CitySizeType>;
type CityStructureKind = keyof typeof citySizes;

function isCityKind(kind: StructureKind): kind is CityStructureKind {
  return kind.startsWith("city-");
}

const facilityFactories: Record<
  FacilityStructureKind,
  (size: FacilitySize, stage?: FacilityConstructionStage) => MapModel
> = {
  solar: (size, stage) => solar(false, size, stage),
  "solar-hail-damaged": (size, stage) =>
    solar(stage === undefined, size, stage),
  wind: (size, stage) =>
    stage === undefined
      ? wind("wind", size)
      : onshoreWindConstruction(size, stage),
  "offshore-wind": (size, stage) =>
    stage === undefined
      ? wind("offshore-wind", size)
      : offshoreWindConstruction(size, stage),
  "airborne-wind": airborne,
  gas: (size, stage) =>
    stage === undefined ? thermal("gas", size) : gasConstruction(size, stage),
  "gas-combined-cycle": (size, stage) =>
    stage === undefined
      ? thermal("gas", size)
      : gasCombinedCycleConstruction(size, stage),
  "gas-steam": gasSteam,
  oil: (size, stage) =>
    stage === undefined ? thermal("oil", size) : oilConstruction(size, stage),
  coal: (size, stage) =>
    stage === undefined ? thermal("coal", size) : coalConstruction(size, stage),
  biomass: (size, stage) =>
    stage === undefined
      ? thermal("biomass", size)
      : biomassConstruction(size, stage),
  nuclear,
  hydro,
  geothermal,
  "enhanced-geothermal": (size, stage) =>
    stage === undefined
      ? geothermal(size)
      : enhancedGeothermalConstruction(size, stage),
  battery: (size, stage) =>
    stage === undefined
      ? storage("battery", size)
      : batteryConstruction(size, stage),
  "iron-air": (size, stage) =>
    stage === undefined
      ? storage("iron-air", size)
      : ironAirConstruction(size, stage),
  "pumped-hydro": pumpedHydro,
};

/** Share city geometry by sector combination and facility geometry by nameplate tier. */
export function getStructureModel(
  kind: StructureKind,
  growth: readonly CityGrowthSector[] = [],
  size: FacilitySize = "medium",
  stage?: FacilityConstructionStage,
): MapModel {
  // These technologies share operating artwork with their conventional counterparts.
  const resolvedKind =
    stage === undefined && kind === "gas-combined-cycle"
      ? "gas"
      : stage === undefined && kind === "enhanced-geothermal"
        ? "geothermal"
        : kind;
  const isCity = isCityKind(resolvedKind);
  const facility = !isCity && resolvedKind !== "tower";
  const variant =
    facility && size !== "medium"
      ? `${resolvedKind}:${size}`
      : isCity && growth.length
        ? `${resolvedKind}:${growth.join("-").toLowerCase()}`
        : resolvedKind;
  const key =
    facility && stage !== undefined
      ? `${variant}:construction:${stage}`
      : variant;
  const cached = models.get(key);
  if (cached) return cached;
  const result = isCity
    ? city(citySizes[resolvedKind], growth, key)
    : resolvedKind === "tower"
      ? tower()
      : facilityFactories[resolvedKind](size, stage);
  const keyed =
    result.key === `structure:${key}`
      ? result
      : { ...result, key: `structure:${key}` };
  models.set(key, keyed);
  return keyed;
}
