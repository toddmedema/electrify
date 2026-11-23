import type { CitySizeType } from "../../../Types";
import type { CityGrowthSector } from "../../../helpers/CityDemand";
import { MeshBuilder } from "./MeshBuilder";
import { PALETTE as P, rgb } from "./Palette";
import type {
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

/** A closed roof prism, rather than a screen-facing roof silhouette. */
function gable(
  mesh: MeshBuilder,
  [x, y, z]: Vec3,
  [width, rise, depth]: Vec3,
  color: RGB,
): void {
  const left = x - width / 2,
    right = x + width / 2,
    back = z - depth / 2,
    front = z + depth / 2;
  mesh
    .triangle([left, y, front], [right, y, front], [x, y + rise, front], color)
    .triangle([right, y, back], [left, y, back], [x, y + rise, back], color)
    .quad(
      [left, y, back],
      [left, y, front],
      [x, y + rise, front],
      [x, y + rise, back],
      color,
    )
    .quad(
      [x, y + rise, back],
      [x, y + rise, front],
      [right, y, front],
      [right, y, back],
      color,
    )
    .quad(
      [left, y, back],
      [right, y, back],
      [right, y, front],
      [left, y, front],
      color,
    );
}

function base(mesh: MeshBuilder, width = 0.64, depth = 0.4): void {
  mesh.box([0, 0.018, 0], [width, 0.036, depth], P.steelShade);
}

/** Drawn cap centers are the conductor endpoints exported to the network. */
function switchgear(mesh: MeshBuilder, z = 0.22): readonly Vec3[] {
  mesh.box([0, 0.065, z], [0.24, 0.09, 0.06], P.steel);
  const terminals: Vec3[] = [];
  for (const x of [-0.085, 0.085]) {
    mesh
      .cylinder([x, 0.11, z], 0.012, 0.012, 0.032, P.cream)
      .cylinder([x, 0.119, z], 0.018, 0.018, 0.008, P.steelShade)
      .cylinder([x, 0.142, z], 0.014, 0.014, 0.008, P.steelShade);
    terminals.push([x, 0.15, z]);
  }
  return terminals;
}

function windows(
  mesh: MeshBuilder,
  x: number,
  y: number,
  z: number,
  width: number,
): ModelPart {
  const glazing = new MeshBuilder().box(
    [x, y, z],
    [width, 0.039, 0.006],
    P.steelShade,
  );
  for (let i = -1; i <= 1; i++)
    mesh.box(
      [x + (i * width) / 4, y, z + 0.004],
      [0.006, 0.039, 0.004],
      P.cream,
    );
  return {
    mesh: glazing.build(),
    material: "facility-window",
    castsShadow: false,
  };
}

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

/** Include the renderer's entire motion envelope in terrain clearance and culling. */
function model(
  kind: string,
  body: MeshBuilder,
  terminals: readonly Vec3[],
  moving: ModelPart[] = [],
): MapModel {
  const parts: ModelPart[] = [
    { mesh: body.build(), castsShadow: true },
    ...moving,
  ];
  let radius = 0,
    height = 0;
  for (const part of parts) {
    const [px, py, pz] = part.position ?? [0, 0, 0];
    const positions = part.mesh.positions;
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i],
        y = positions[i + 1],
        z = positions[i + 2];
      if (part.motion === "rotor" || part.motion === "sway") {
        // Full rotation is a conservative bound for the wing's gentle sway too.
        const reach = Math.hypot(x, y);
        radius = Math.max(radius, Math.hypot(Math.abs(px) + reach, pz + z));
        height = Math.max(height, py + reach);
      } else if (part.motion === "steam") {
        radius = Math.max(
          radius,
          Math.hypot(
            Math.abs(px) + Math.abs(x) * 1.3,
            Math.abs(pz) + Math.abs(z) * 1.3,
          ),
        );
        height = Math.max(height, py + Math.max(y * 0.65, y * 1.3) + 0.28);
      } else {
        radius = Math.max(radius, Math.hypot(px + x, pz + z));
        height = Math.max(
          height,
          py +
            y +
            (part.motion === "flow" ? 0.018 : 0) +
            (part.waterLevelRange ? Math.max(...part.waterLevelRange) : 0),
        );
      }
    }
  }
  return {
    key: `structure:${kind}`,
    parts,
    terminals,
    footprint: radius * 2 + 0.002,
    height: height + 0.002,
  };
}

type FacilityStructureKind = Exclude<
  StructureKind,
  `city-${CitySizeType}` | "tower"
>;

function facilityModel(
  kind: FacilityStructureKind,
  body: MeshBuilder,
  terminals: readonly Vec3[],
  details: ModelPart[] = [],
): MapModel {
  const result = model(kind, body, terminals, details);
  return {
    ...result,
    parts: result.parts.map((part) => ({
      ...part,
      material: part.material ?? "facility-surface",
    })),
  };
}

/** Small separated panes stay legible on both sunlit and shaded city facades. */
function cityWindows(
  mesh: MeshBuilder,
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
    mesh.quad(
      [left, low, front],
      [left + pane, low, front],
      [left + pane, high, front],
      [left, high, front],
      P.mint,
    );
  }
  for (const offset of [-depth / 4, depth / 4]) {
    const back = z + offset - pane / 2;
    mesh.quad(
      [right, low, back + pane],
      [right, low, back],
      [right, high, back],
      [right, high, back + pane],
      P.mint,
    );
  }
}

function townhouse(mesh: MeshBuilder, x: number, z: number, roof: RGB): void {
  mesh.box([x, 0.095, z], [0.1, 0.118, 0.11], P.cream);
  gable(mesh, [x, 0.154, z], [0.116, 0.045, 0.126], roof);
  cityWindows(mesh, x, 0.117, z, 0.1, 0.11);
  mesh.box([x, 0.065, z + 0.057], [0.022, 0.058, 0.004], P.timber);
}

function cityBlock(
  mesh: MeshBuilder,
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
      mesh,
      x,
      bottom + 0.041 + floor * floorHeight,
      z,
      width - inset,
      depth - inset,
    );
  }
}

function workshop(mesh: MeshBuilder, x: number, z: number): void {
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
  mesh.box([x - 0.032, 0.101, z + 0.05], [0.035, 0.014, 0.003], P.mint);
}

function city(
  size: CitySizeType,
  growth: readonly CityGrowthSector[],
  key: string,
): MapModel {
  const body = new MeshBuilder();
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
    townhouse(body, -0.225, -0.105, P.forest);
    townhouse(body, -0.075, -0.105, P.steelShade);
    townhouse(body, 0.035, -0.105, P.timber);
    townhouse(body, 0.205, 0.16, P.forest);
    cityBlock(body, -0.17, 0.155, 0.13, 0.11, 3, P.steelShade);
  } else if (size === "medium") {
    cityBlock(body, -0.215, -0.12, 0.13, 0.14, 4, P.forest);
    cityBlock(body, -0.035, -0.12, 0.15, 0.14, 5, P.steelShade);
    cityBlock(body, -0.025, 0.16, 0.15, 0.11, 3, P.steelShade);
    townhouse(body, -0.225, 0.16, P.timber);
    townhouse(body, 0.205, 0.16, P.forest);
  } else {
    cityBlock(body, -0.215, -0.125, 0.14, 0.15, 6, P.forest);
    cityBlock(body, -0.025, -0.125, 0.16, 0.16, 9, P.steelShade, true);
    cityBlock(body, -0.085, 0.16, 0.13, 0.11, 4, P.steelShade);
    cityBlock(body, 0.08, 0.16, 0.13, 0.11, 6, P.forest);
    townhouse(body, -0.24, 0.16, P.timber);
    townhouse(body, 0.24, 0.16, P.forest);
  }
  // Each sector has a separate lot. Adding a block never moves an existing building or terminal.
  if (growth.includes("Residential")) {
    body.box([-0.334, 0.018, 0.025], [0.136, 0.036, 0.147], P.steel);
    townhouse(body, -0.334, 0.025, P.forest);
  }
  if (growth.includes("Commercial")) {
    const shopX = 0.356,
      shopZ = 0.091;
    body.box([shopX, 0.018, shopZ], [0.134, 0.036, 0.134], P.steel);
    cityBlock(body, shopX, shopZ, 0.094, 0.104, 2, P.timber);
    body.box([shopX, 0.104, shopZ + 0.057], [0.094, 0.025, 0.022], P.forest);
  }
  if (growth.includes("Industrial")) workshop(body, 0.198, 0.297);
  return model(key, body, switchgear(body, 0.27));
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

function solar(damaged = false): MapModel {
  const body = new MeshBuilder(),
    glints = new MeshBuilder();
  const tilt = 0.36;
  for (const z of [-0.18, 0, 0.18]) {
    const broken = damaged && z !== -0.18;
    const center = z === 0 ? -0.164 : 0.164;
    const panel = new MeshBuilder().box(
      [0, 0, 0],
      [0.612, 0.014, 0.152],
      P.steel,
    );
    const intact = broken
      ? [
          [-0.3, center - 0.106],
          [center + 0.106, 0.3],
        ]
      : [[-0.3, 0.3]];
    for (const [left, right] of intact) {
      const mid = (left + right) / 2;
      panel
        .box([mid, 0.009, 0], [right - left, 0.004, 0.14], P.solar)
        .box([mid, 0.012, 0], [right - left, 0.002, 0.003], P.steel);
    }
    for (const x of [-0.15, 0, 0.15])
      if (!broken || Math.abs(center - x) > 0.106)
        panel.box([x, 0.012, 0], [0.003, 0.002, 0.14], P.steel);
    if (broken) shatteredPanel(panel, center);
    body.merge(panel.build(), [0, 0.115, z], [tilt, 0, 0]);
    for (const x of [-0.23, 0.23])
      for (const dz of [-0.045, 0.045]) {
        const top = 0.107 - Math.sin(tilt) * dz;
        body.box(
          [x, top / 2, z + dz * Math.cos(tilt)],
          [0.012, top, 0.012],
          P.steelShade,
        );
      }
    if (!broken)
      glints.merge(
        new MeshBuilder()
          .box([0, 0.014, -0.037], [0.58, 0.002, 0.01], P.solar)
          .build(),
        [0, 0.115, z],
        [tilt, 0, 0],
      );
  }
  if (damaged)
    body
      .triangle(
        [0.24, 0.004, 0.27],
        [0.28, 0.006, 0.28],
        [0.26, 0.004, 0.31],
        fracturedGlass,
      )
      .triangle(
        [-0.26, 0.004, 0.29],
        [-0.29, 0.006, 0.28],
        [-0.247, 0.004, 0.268],
        P.solar,
      );
  // Bring the conductors out beside the racks via low feeders under the panels.
  const terminals: Vec3[] = [
    [-0.34, 0.036, 0],
    [0.34, 0.036, 0],
    [0, 0.036, -0.29],
    [0, 0.036, 0.29],
  ];
  body.box([0, 0.023, 0], [0.13, 0.046, 0.1], P.steel);
  for (const terminal of terminals) {
    body
      .beam([0, terminal[1], 0], terminal, 0.006, P.ink)
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
    [effect(glints.build(), "pulse")],
  );
}

/** A small solid loft: rounded +X leading edge, thin -X trailing edge. */
function windBlade(): MapMesh {
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
  ] as const;
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
        edge < 2 ? P.steel : edge < 4 ? P.mint : P.cream,
      );
    }
  for (let edge = 0; edge < profile.length; edge++) {
    const next = (edge + 1) % profile.length,
      tip = sections.length - 1;
    mesh.triangle(
      [sections[0][1], sections[0][0], sections[0][2]],
      rings[0][edge],
      rings[0][next],
      P.steel,
    );
    mesh.triangle(
      [sections[tip][1], sections[tip][0], sections[tip][2]],
      rings[tip][next],
      rings[tip][edge],
      P.cream,
    );
  }
  return mesh.build();
}

function wind(kind: "wind" | "offshore-wind"): MapModel {
  const offshore = kind === "offshore-wind",
    body = new MeshBuilder();
  const deck = offshore ? 0.09 : 0.035;
  if (offshore) {
    for (const x of [-0.1, 0.1])
      for (const z of [-0.08, 0.08]) {
        body.beam([x * 1.3, 0.006, z * 1.3], [x, deck, z], 0.012, P.steelShade);
        body.beam([-x, 0.005, z], [x, deck, z], 0.006, P.steelShade);
      }
    body.box([0, deck, 0], [0.3, 0.025, 0.25], P.steel);
  } else body.box([0, deck / 2, 0], [0.16, deck, 0.15], P.steel);
  body.cylinder([0, deck, 0], 0.026, 0.015, 0.48, P.cream, 8);
  const pivot: Vec3 = [0, deck + 0.475, 0.045];
  body.box([0, pivot[1], 0], [0.07, 0.045, 0.1], P.steel);
  const rotor = new MeshBuilder();
  const blade = windBlade();
  for (let i = 0; i < 3; i++)
    rotor.merge(blade, [0, 0, 0], [0, 0, (i * TAU) / 3]);
  rotor.merge(
    new MeshBuilder()
      .cylinder([0, 0, 0], 0.025, 0.018, 0.028, P.cream, 8)
      .build(),
    [0, 0, 0.022],
    [Math.PI / 2, 0, 0],
  );
  return facilityModel(kind, body, switchgear(body, 0.12), [
    {
      mesh: rotor.build(),
      position: pivot,
      motion: "rotor",
      castsShadow: true,
    },
  ]);
}

function airborne(): MapModel {
  const body = new MeshBuilder();
  base(body, 0.3, 0.23);
  body.box([0, 0.078, 0], [0.23, 0.085, 0.17], P.cream);
  body.merge(
    new MeshBuilder()
      .cylinder([0, 0, 0], 0.046, 0.046, 0.13, P.steelShade, 8)
      .build(),
    [-0.065, 0.09, 0.065],
    [0, 0, -Math.PI / 2],
  );
  body.beam([0, 0.12, 0], [0, 0.64, 0], 0.004, P.steelShade);
  const wing = new MeshBuilder();
  const rim: Vec3[] = [
    [-0.33, 0, 0.01],
    [-0.11, 0.025, -0.12],
    [0, 0.045, -0.075],
    [0.11, 0.025, -0.12],
    [0.33, 0, 0.01],
    [0.1, -0.015, 0.12],
    [0, -0.005, 0.075],
    [-0.1, -0.015, 0.12],
  ];
  for (let i = 0; i < rim.length; i++) {
    const a = rim[i],
      b = rim[(i + 1) % rim.length];
    wing.triangle([0, 0.045, 0], b, a, i % 2 ? P.mint : P.forestLight);
    wing.triangle([0, -0.018, 0], a, b, P.steel);
  }
  wing
    .beam(rim[0], [0, 0.045, 0], 0.004, P.steelShade)
    .beam([0, 0.045, 0], rim[4], 0.004, P.steelShade);
  return facilityModel("airborne-wind", body, switchgear(body, 0.14), [
    {
      mesh: wing.build(),
      position: [0, 0.64, 0],
      motion: "sway",
      castsShadow: true,
    },
    windows(body, 0, 0.08, 0.088, 0.14),
  ]);
}

function thermal(kind: "gas" | "oil" | "coal" | "biomass"): MapModel {
  const body = new MeshBuilder(),
    moving: ModelPart[] = [];
  base(body);
  body.box([0.075, 0.105, 0.015], [0.4, 0.15, 0.28], P.cream);
  gable(
    body,
    [0.075, 0.18, 0.015],
    [0.42, 0.045, 0.3],
    kind === "biomass" ? P.forest : P.steel,
  );
  moving.push(windows(body, 0.08, 0.1, 0.159, 0.29));
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
    for (const x of [0.03, 0.19]) stack(x, -0.1, 0.3, 0.022);
    body.merge(
      new MeshBuilder()
        .cylinder([0, 0, 0], 0.066, 0.066, 0.22, P.steel, 8)
        .build(),
      [-0.24, 0.105, 0.12],
      [Math.PI / 2, 0, 0],
    );
    body.beam([-0.3, 0.06, -0.15], [-0.14, 0.06, -0.15], 0.014, P.mint);
  } else if (kind === "oil") {
    for (const z of [-0.1, 0.09]) {
      body.cylinder([-0.23, 0.036, z], 0.08, 0.08, 0.15, P.cream, 8);
      body.cylinder([-0.23, 0.186, z], 0.081, 0.025, 0.035, P.steel, 8);
      body.cylinder([-0.23, 0.085, z], 0.081, 0.081, 0.013, P.steelShade, 8);
    }
    stack(0.21, -0.11, 0.4);
  } else if (kind === "coal") {
    body.box([-0.225, 0.075, -0.025], [0.17, 0.08, 0.29], P.steelShade);
    gable(body, [-0.225, 0.115, -0.025], [0.14, 0.07, 0.25], P.ink);
    body.beam([-0.22, 0.15, 0.08], [-0.035, 0.22, 0.02], 0.022, P.steelShade);
    stack(0.21, -0.11, 0.43, 0.031);
  } else {
    body.cylinder([-0.225, 0.036, -0.02], 0.082, 0.082, 0.23, P.cream, 8);
    body.cylinder([-0.225, 0.266, -0.02], 0.087, 0.02, 0.06, P.forest, 8);
    for (const y of [0.1, 0.21])
      body.cylinder([-0.225, y, -0.02], 0.084, 0.084, 0.01, P.steelShade, 8);
    stack(0.22, -0.11, 0.33);
    body.box([-0.19, 0.06, 0.155], [0.19, 0.045, 0.055], P.timber);
  }
  return facilityModel(kind, body, switchgear(body), moving);
}

function gasSteam(): MapModel {
  const body = new MeshBuilder();
  base(body);

  // A tall boiler house supplies steam to the lower turbine hall through the overhead pipe.
  body.box([-0.15, 0.169, -0.04], [0.25, 0.266, 0.25], P.cream);
  gable(body, [-0.15, 0.302, -0.04], [0.27, 0.041, 0.27], P.steel);
  body.box([0.13, 0.104, 0.023], [0.31, 0.136, 0.26], P.cream);
  gable(body, [0.13, 0.172, 0.023], [0.33, 0.034, 0.28], P.steelShade);
  body.beam([-0.026, 0.25, -0.07], [0.102, 0.25, -0.07], 0.027, P.steel, 8);
  body.beam([0.102, 0.25, -0.07], [0.102, 0.161, -0.07], 0.027, P.steel, 8);
  body.box([-0.15, 0.085, 0.092], [0.098, 0.098, 0.016], P.steelShade);

  const stackX = 0.27,
    stackZ = 0.12,
    outletY = 0.473;
  body
    .cylinder([stackX, 0.036, stackZ], 0.041, 0.031, 0.437, P.steel, 8)
    .cylinder([stackX, 0.443, stackZ], 0.038, 0.038, 0.03, P.steelShade, 8)
    .cylinder([stackX, outletY, stackZ], 0.026, 0.026, 0.002, P.ink, 8);
  return facilityModel("gas-steam", body, switchgear(body), [
    windows(body, 0.13, 0.113, 0.157, 0.227),
    steam([stackX, outletY + 0.012, stackZ]),
    steam([stackX, outletY + 0.012, stackZ], 0.5),
  ]);
}

function nuclear(): MapModel {
  const body = new MeshBuilder();
  base(body);
  const cx = -0.16,
    cz = -0.035;
  const profile = [
    [0.036, 0.142],
    [0.125, 0.105],
    [0.24, 0.078],
    [0.365, 0.112],
  ];
  for (let ring = 0; ring < profile.length - 1; ring++)
    for (let side = 0; side < 10; side++) {
      const a = (side * TAU) / 10,
        b = ((side + 1) * TAU) / 10;
      const [low, lr] = profile[ring],
        [high, hr] = profile[ring + 1];
      body.quad(
        [cx + Math.cos(b) * lr, low, cz + Math.sin(b) * lr],
        [cx + Math.cos(a) * lr, low, cz + Math.sin(a) * lr],
        [cx + Math.cos(a) * hr, high, cz + Math.sin(a) * hr],
        [cx + Math.cos(b) * hr, high, cz + Math.sin(b) * hr],
        P.cream,
      );
    }
  body.cylinder([cx, 0.335, cz], 0.092, 0.092, 0.006, P.ink, 10);
  for (let side = 0; side < 10; side++) {
    const a = (side * TAU) / 10,
      b = ((side + 1) * TAU) / 10;
    body.quad(
      [cx + Math.cos(a) * 0.112, 0.365, cz + Math.sin(a) * 0.112],
      [cx + Math.cos(a) * 0.092, 0.365, cz + Math.sin(a) * 0.092],
      [cx + Math.cos(b) * 0.092, 0.365, cz + Math.sin(b) * 0.092],
      [cx + Math.cos(b) * 0.112, 0.365, cz + Math.sin(b) * 0.112],
      P.steel,
    );
  }
  body.cylinder([0.17, 0.036, -0.04], 0.115, 0.115, 0.125, P.steel, 10);
  body.cylinder([0.17, 0.161, -0.04], 0.115, 0.089, 0.065, P.cream, 10);
  body.cylinder([0.17, 0.226, -0.04], 0.089, 0.035, 0.035, P.cream, 10);
  body.cylinder([0.17, 0.261, -0.04], 0.035, 0, 0.01, P.cream, 10);
  body.box([0.13, 0.075, 0.13], [0.32, 0.1, 0.13], P.cream);
  const glazing = windows(body, 0.13, 0.085, 0.198, 0.23);
  return facilityModel("nuclear", body, switchgear(body), [
    glazing,
    steam([cx, 0.39, cz]),
    steam([cx, 0.39, cz], 0.5),
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

function hydro(): MapModel {
  const body = new MeshBuilder(),
    water = new MeshBuilder(),
    flow = new MeshBuilder();
  base(body, 0.7, 0.45);
  // Basin floor stays exposed at empty. The front dam and back retaining wall
  // still frame the water as it rises beneath the crest.
  body.box([0, 0.063, -0.105], [0.66, 0.08, 0.26], P.steelShade);
  body.box([0, 0.167, -0.242], [0.69, 0.29, 0.025], P.steel);
  const front = (x: number) => 0.12 - 0.15 * (x / 0.32) ** 2;
  for (let i = 0; i < 8; i++) {
    const x = -0.32 + i * 0.08,
      next = x + 0.08,
      a = front(x),
      b = front(next);
    body
      .quad(
        [x, 0.035, a + 0.07],
        [next, 0.035, b + 0.07],
        [next, 0.32, b],
        [x, 0.32, a],
        i % 2 ? P.cream : P.steel,
      )
      .quad(
        [x, 0.32, a],
        [next, 0.32, b],
        [next, 0.32, b - 0.065],
        [x, 0.32, a - 0.065],
        P.cream,
      )
      .quad(
        [next, 0.035, b - 0.08],
        [x, 0.035, a - 0.08],
        [x, 0.32, a - 0.065],
        [next, 0.32, b - 0.065],
        P.steel,
      );
    water.quad(
      [x, 0.275, -0.228],
      [x, 0.275, a - 0.067],
      [next, 0.275, b - 0.067],
      [next, 0.275, -0.228],
      P.water,
    );
    body.beam(
      [x, 0.337, a - 0.012],
      [next, 0.337, b - 0.012],
      0.01,
      P.steelShade,
    );
  }
  for (const x of [-0.335, 0.335])
    body.box([x, 0.17, -0.08], [0.03, 0.3, 0.33], P.cream);
  // A real sloping water chute runs down the convex downstream face.
  body.quad(
    [-0.067, 0.055, 0.199],
    [0.067, 0.055, 0.199],
    [0.052, 0.306, 0.124],
    [-0.052, 0.306, 0.124],
    P.deepWater,
  );
  for (const x of [-0.065, 0.065])
    body.beam([x, 0.32, 0.12], [x * 1.15, 0.046, 0.205], 0.011, P.cream);
  for (const y of [0.12, 0.2, 0.27]) {
    const z = 0.124 + ((0.306 - y) / 0.251) * 0.075;
    flow.box([0, y, z + 0.004], [0.087, 0.008, 0.008], P.water);
  }
  body.box([-0.22, 0.084, 0.145], [0.17, 0.12, 0.14], P.cream);
  gable(body, [-0.22, 0.144, 0.145], [0.19, 0.025, 0.155], P.steel);
  const glazing = windows(body, -0.22, 0.085, 0.218, 0.11);
  return facilityModel("hydro", body, switchgear(body, 0.245), [
    glazing,
    reservoir(water, [-0.174, 0.021]),
    effect(flow.build(), "flow"),
  ]);
}

function geothermal(): MapModel {
  const body = new MeshBuilder();
  base(body);
  body.box([0.105, 0.09, 0.06], [0.38, 0.12, 0.24], P.cream);
  gable(body, [0.105, 0.15, 0.06], [0.4, 0.035, 0.26], P.steel);
  const glazing = windows(body, 0.105, 0.09, 0.183, 0.25);
  for (const [x, z, height] of [
    [-0.235, -0.09, 0.24],
    [-0.15, 0.1, 0.19],
  ]) {
    body.cylinder([x, 0.035, z], 0.035, 0.035, 0.025, P.ink);
    body.beam([x, 0.045, z], [x, height, z], 0.019, P.steel, 6);
    body.beam([x, height, z], [x + 0.1, height, z], 0.019, P.steel, 6);
    body.beam([x + 0.1, height, z], [x + 0.1, 0.13, z], 0.019, P.steel, 6);
    body.box([x, height - 0.045, z], [0.05, 0.012, 0.05], P.mint);
  }
  body.cylinder([0.2, 0.15, -0.075], 0.025, 0.025, 0.14, P.steel, 6);
  return facilityModel("geothermal", body, switchgear(body), [
    glazing,
    steam([0.2, 0.31, -0.075]),
    steam([0.2, 0.31, -0.075], 0.5),
  ]);
}

function storage(kind: "battery" | "iron-air"): MapModel {
  const body = new MeshBuilder(),
    flow = new MeshBuilder();
  base(body);
  if (kind === "battery") {
    for (const x of [-0.16, 0.16]) {
      body.box([x, 0.17, 0], [0.21, 0.27, 0.26], P.cream);
      body.box([x, 0.312, 0], [0.13, 0.016, 0.13], P.steelShade);
      body.box([x, 0.19, 0.133], [0.105, 0.1, 0.006], P.mint);
      for (const y of [0.085, 0.105])
        body.box([x, y, 0.134], [0.12, 0.006, 0.007], P.steelShade);
      flow.box([x, 0.19, 0.139], [0.07, 0.008, 0.005], P.cream);
    }
  } else {
    body.box([0, 0.15, 0], [0.58, 0.23, 0.29], P.cream);
    body.box([0, 0.279, 0], [0.61, 0.03, 0.32], P.steel);
    body.box([0, 0.185, 0.148], [0.48, 0.095, 0.007], P.steelShade);
    for (let i = 0; i < 7; i++)
      body.box(
        [-0.21 + i * 0.07, 0.185, 0.155],
        [0.013, 0.095, 0.008],
        P.steel,
      );
    for (const x of [-0.15, 0.15]) {
      body.cylinder([x, 0.295, 0], 0.055, 0.055, 0.006, P.steelShade, 8);
      body.beam([x - 0.04, 0.302, 0], [x + 0.04, 0.302, 0], 0.005, P.steel);
      body.box([x, 0.085, 0.15], [0.12, 0.045, 0.007], P.mint);
      flow.box([x, 0.085, 0.157], [0.075, 0.008, 0.005], P.cream);
    }
  }
  return facilityModel(kind, body, switchgear(body), [
    effect(flow.build(), "flow"),
  ]);
}

function pumpedHydro(): MapModel {
  const body = new MeshBuilder(),
    flow = new MeshBuilder();
  base(body, 0.66, 0.45);
  const basin = (
    x: number,
    z: number,
    top: number,
    width: number,
    depth: number,
    upper: boolean,
  ) => {
    const bottom = Math.max(0.037, top * 0.24);
    body.box([x, bottom / 2, z], [width, bottom, depth], P.steelShade);
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
    for (const sign of [-1, 1]) {
      body.box(
        [x + (sign * width) / 2, top / 2 + 0.015, z],
        [0.025, top + 0.03, depth + 0.025],
        P.cream,
      );
      body.box(
        [x, top / 2 + 0.015, z + (sign * depth) / 2],
        [width, top + 0.03, 0.025],
        P.cream,
      );
    }
    // Stored energy tracks the upper basin. The lower basin declines as the upper fills.
    const empty = bottom - top - 0.001,
      full = 0.01;
    return reservoir(water, upper ? [empty, full] : [full, empty]);
  };
  const upper = basin(-0.13, -0.105, 0.26, 0.33, 0.2, true);
  const lower = basin(0.17, 0.13, 0.075, 0.26, 0.17, false);
  const pipe: Vec3[] = [
    [0.048, 0.22, -0.1],
    [0.105, 0.22, -0.1],
    [0.105, 0.09, 0.035],
    [-0.1, 0.09, 0.11],
  ];
  for (let i = 0; i < pipe.length - 1; i++)
    body.beam(pipe[i], pipe[i + 1], 0.022, P.steel, 8);
  for (const [x, y, z] of [
    [0.07, 0.22, -0.1],
    [0.105, 0.15, -0.03],
    [0, 0.09, 0.07],
  ])
    flow.box([x, y, z], [0.02, 0.025, 0.02], P.mint);
  body.box([-0.19, 0.077, 0.13], [0.21, 0.12, 0.15], P.cream);
  gable(body, [-0.19, 0.137, 0.13], [0.23, 0.025, 0.17], P.steel);
  const glazing = windows(body, -0.19, 0.085, 0.208, 0.14);
  return facilityModel("pumped-hydro", body, switchgear(body, 0.245), [
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

const factories: Record<
  Exclude<StructureKind, CityStructureKind>,
  () => MapModel
> = {
  tower,
  solar,
  "solar-hail-damaged": () => solar(true),
  wind: () => wind("wind"),
  "offshore-wind": () => wind("offshore-wind"),
  "airborne-wind": airborne,
  gas: () => thermal("gas"),
  "gas-steam": gasSteam,
  oil: () => thermal("oil"),
  coal: () => thermal("coal"),
  biomass: () => thermal("biomass"),
  nuclear,
  hydro,
  geothermal,
  battery: () => storage("battery"),
  "iron-air": () => storage("iron-air"),
  "pumped-hydro": pumpedHydro,
};

/** Cities share geometry by size and sector combination. Other structures retain one model per kind. */
export function getStructureModel(
  kind: StructureKind,
  growth: readonly CityGrowthSector[] = [],
): MapModel {
  const isCity = isCityKind(kind);
  const key =
    isCity && growth.length
      ? `${kind}:${growth.join("-").toLowerCase()}`
      : kind;
  const cached = models.get(key);
  if (cached) return cached;
  const result = isCity
    ? city(citySizes[kind], growth, key)
    : factories[kind]();
  models.set(key, result);
  return result;
}
