import { PALETTE } from "./Palette";
import { getStructureModel } from "./StructureModels";
import type {
  FacilitySize,
  MapMesh,
  ModelPart,
  RGB,
  StructureKind,
  Vec3,
} from "./Types";

// The union owns the inventory: adding a kind requires giving it these contracts.
const inventory: Record<StructureKind, true> = {
  "city-small": true,
  "city-medium": true,
  "city-large": true,
  tower: true,
  solar: true,
  "solar-hail-damaged": true,
  wind: true,
  "offshore-wind": true,
  "airborne-wind": true,
  gas: true,
  "gas-steam": true,
  oil: true,
  coal: true,
  biomass: true,
  nuclear: true,
  hydro: true,
  geothermal: true,
  battery: true,
  "iron-air": true,
  "pumped-hydro": true,
};
const kinds = Object.keys(inventory) as StructureKind[];
const facilityKinds = kinds.filter(
  (kind) => kind !== "tower" && !kind.startsWith("city-"),
);
const variants: { kind: StructureKind; size: FacilitySize }[] = kinds.map(
  (kind) => ({ kind, size: "medium" }),
);
for (const kind of facilityKinds)
  variants.push({ kind, size: "small" }, { kind, size: "large" });

it.each(["city-small", "city-medium", "city-large"] as const)(
  "%s grows distinct solid buildings within the tile and retains its wire terminals",
  (kind) => {
    const opening = getStructureModel(kind);
    const sectors = ["Residential", "Commercial", "Industrial"] as const;
    const singleSector = sectors.map((sector) =>
      getStructureModel(kind, [sector]),
    );
    const grown = getStructureModel(kind, sectors);

    for (const model of [...singleSector, grown]) {
      expect(model.parts[0].mesh.positions.length).toBeGreaterThan(
        opening.parts[0].mesh.positions.length,
      );
      expect(model.parts[0].mesh.positions.length / 9).toBeLessThan(1500);
      expect(model.terminals).toEqual(opening.terminals);
      expect(model.footprint).toBeLessThan(1);
    }
    expect(new Set(singleSector.map((variant) => variant.key)).size).toBe(3);
    expect(getStructureModel(kind, [...sectors])).toBe(grown);
  },
);

function vertices(mesh: MapMesh): Vec3[] {
  const result: Vec3[] = [];
  for (let i = 0; i < mesh.positions.length; i += 3)
    result.push([
      mesh.positions[i],
      mesh.positions[i + 1],
      mesh.positions[i + 2],
    ]);
  return result;
}

function coloredVertices(mesh: MapMesh, color: RGB): Vec3[] {
  return vertices(mesh).filter((_point, i) =>
    color.every(
      (component, axis) =>
        Math.abs(component - mesh.colors[i * 3 + axis]) < 0.000001,
    ),
  );
}

function upperSurfaceNormals(mesh: MapMesh, color: RGB): number[] {
  return vertices(mesh).flatMap((_point, i) =>
    color.every((c, axis) => Math.abs(c - mesh.colors[i * 3 + axis]) < 0.000001)
      ? [mesh.normals[i * 3 + 1]]
      : [],
  );
}

/** Intersect the actual triangles, so a uniformly extruded plate cannot pass as a loft. */
function bladeSection(mesh: MapMesh, height: number) {
  const points = vertices(mesh),
    edges: Vec3[][] = [];
  for (let i = 0; i < points.length; i += 3) {
    const triangle = points.slice(i, i + 3),
      intersections: Vec3[] = [];
    for (let j = 0; j < 3; j++) {
      const a = triangle[j],
        b = triangle[(j + 1) % 3],
        aBelow = a[1] < height,
        bBelow = b[1] < height;
      if (aBelow === bBelow) continue;
      const t = (height - a[1]) / (b[1] - a[1]);
      intersections.push([
        a[0] + (b[0] - a[0]) * t,
        height,
        a[2] + (b[2] - a[2]) * t,
      ]);
    }
    if (intersections.length === 2) edges.push(intersections);
  }
  const section = edges.flat(),
    minX = Math.min(...section.map((p) => p[0])),
    maxX = Math.max(...section.map((p) => p[0]));
  return {
    chord: maxX - minX,
    centerX: (minX + maxX) / 2,
    depth:
      Math.max(...section.map((p) => p[2])) -
      Math.min(...section.map((p) => p[2])),
    thicknessAt(fraction: number) {
      const x = minX + (maxX - minX) * fraction,
        z = edges.flatMap(([a, b]) => {
          const aBefore = a[0] < x,
            bBefore = b[0] < x;
          if (aBefore === bBefore) return [];
          return [a[2] + ((b[2] - a[2]) * (x - a[0])) / (b[0] - a[0])];
        });
      return Math.max(...z) - Math.min(...z);
    },
  };
}

/** Contract poses sampled independently of factory metadata, including end-of-steam-cycle. */
function posed(part: ModelPart, point: Vec3, cycle: number): Vec3 {
  let [x, y, z] = point;
  const phase = (cycle + (part.phaseOffset ?? 0)) * Math.PI * 2;
  const angle =
    part.motion === "rotor"
      ? -phase
      : part.motion === "sway"
        ? Math.sin(phase) * 0.045
        : 0;
  const rotatedX = x * Math.cos(angle) - y * Math.sin(angle);
  y = x * Math.sin(angle) + y * Math.cos(angle);
  x = rotatedX;
  if (part.motion === "steam") {
    const age = (cycle + (part.phaseOffset ?? 0)) % 1;
    const scale = 0.65 + age * 0.65;
    x *= scale;
    y = y * scale + age * 0.28;
    z *= scale;
  }
  if (part.motion === "flow") y += Math.sin(phase) * 0.018;
  const offset = part.position ?? [0, 0, 0];
  return [x + offset[0], y + offset[1], z + offset[2]];
}

describe.each(variants)("$kind $size model", ({ kind, size }) => {
  it("caches solid finite geometry with a bounded map-scale triangle count", () => {
    const model = getStructureModel(kind, [], size);
    expect(getStructureModel(kind, [], size)).toBe(model);
    expect(model.key).toBe(
      size === "medium" ? `structure:${kind}` : `structure:${kind}:${size}`,
    );
    expect(model.parts[0].motion).toBeUndefined();
    expect(model.parts[0].castsShadow).toBe(true);
    let triangles = 0;
    for (const { mesh } of model.parts) {
      expect(mesh.positions.length).toBeGreaterThan(0);
      expect(mesh.positions.length % 9).toBe(0);
      expect(mesh.normals).toHaveLength(mesh.positions.length);
      expect(mesh.colors).toHaveLength(mesh.positions.length);
      expect(
        [...mesh.positions, ...mesh.normals, ...mesh.colors].every(
          Number.isFinite,
        ),
      ).toBe(true);
      let worstNormalError = 0;
      for (let i = 0; i < mesh.normals.length; i += 3)
        worstNormalError = Math.max(
          worstNormalError,
          Math.abs(
            Math.hypot(
              mesh.normals[i],
              mesh.normals[i + 1],
              mesh.normals[i + 2],
            ) - 1,
          ),
        );
      expect(worstNormalError).toBeLessThan(0.000001);
      triangles += mesh.positions.length / 9;
    }
    expect(triangles).toBeLessThan(1500);
    const ground = vertices(model.parts[0].mesh);
    expect(Math.min(...ground.map((v) => v[1]))).toBeGreaterThanOrEqual(-0.001);
    expect(
      Math.max(...ground.map((v) => v[2])) -
        Math.min(...ground.map((v) => v[2])),
    ).toBeGreaterThan(0.035);
  });

  it("encloses the XZ diameter and the full animated height", () => {
    const model = getStructureModel(kind, [], size);
    let diameter = 0,
      height = 0;
    for (const part of model.parts)
      for (const point of vertices(part.mesh))
        for (const cycle of [
          0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 0.99999,
        ]) {
          const [x, y, z] = posed(part, point, cycle);
          diameter = Math.max(diameter, Math.hypot(x, z) * 2);
          height = Math.max(height, y);
        }
    expect(model.footprint).toBeGreaterThanOrEqual(diameter);
    expect(model.height).toBeGreaterThanOrEqual(height);
    expect(model.footprint).toBeLessThan(0.95);
    expect(model.height).toBeLessThan(1.1);
  });

  it("connects conductors to drawn stationary terminal caps", () => {
    const model = getStructureModel(kind, [], size);
    const body = vertices(model.parts[0].mesh);
    const solar = kind === "solar" || kind === "solar-hail-damaged";
    const [minHeight, maxHeight] = solar ? [0, 0.06] : [0.1, Infinity];
    expect(model.terminals).toHaveLength(solar ? 4 : 2);
    for (const terminal of model.terminals) {
      expect(terminal[1]).toBeGreaterThan(minHeight);
      expect(terminal[1]).toBeLessThanOrEqual(maxHeight);
      const closest = Math.min(
        ...body.map((point) =>
          Math.hypot(
            point[0] - terminal[0],
            point[1] - terminal[1],
            point[2] - terminal[2],
          ),
        ),
      );
      expect(closest).toBeLessThan(0.000001);
    }
    expect(model.terminals[0][0]).toBeLessThan(model.terminals[1][0]);
  });
});

it.each(facilityKinds)(
  "builds distinct grounded geometry for every %s tier",
  (kind) => {
    const geometry = (["small", "medium", "large"] as const).map((size) =>
      getStructureModel(kind, [], size).parts[0].mesh.positions.join(","),
    );
    expect(new Set(geometry).size).toBe(3);
  },
);

it("keeps the empty-land tower small and quiet", () => {
  const model = getStructureModel("tower");
  expect(model.footprint).toBeLessThan(0.2);
  expect(model.height).toBeLessThan(0.32);
  expect(coloredVertices(model.parts[0].mesh, PALETTE.ink)).toHaveLength(0);
  expect(coloredVertices(model.parts[0].mesh, PALETTE.mint)).toHaveLength(0);
});

it("grows one mixed city family through denser windows and a taller skyline", () => {
  const cities = (["small", "medium", "large"] as const).map((size) =>
    getStructureModel(`city-${size}`),
  );
  for (const city of cities) {
    const mesh = city.parts[0].mesh;
    expect(city.parts).toHaveLength(1);
    expect(coloredVertices(mesh, PALETTE.grass).length).toBeGreaterThan(0);
    expect(coloredVertices(mesh, PALETTE.forestLight).length).toBeGreaterThan(
      0,
    );
    expect(coloredVertices(mesh, PALETTE.timber).length).toBeGreaterThan(0);
    expect(coloredVertices(mesh, PALETTE.smoke)).toHaveLength(0);
    // A paved street and a low green park remain visible in every tier.
    expect(
      coloredVertices(mesh, PALETTE.steelShade).some(
        ([x, y]) => Math.abs(x) > 0.3 && y < 0.05,
      ),
    ).toBe(true);
    expect(
      Math.max(...coloredVertices(mesh, PALETTE.grass).map((v) => v[1])),
    ).toBeLessThan(0.06);
    // Gabled townhouses survive the higher-density tiers rather than becoming factories.
    expect(
      upperSurfaceNormals(mesh, PALETTE.timber).some(
        (normal) => normal > 0.5 && normal < 0.9,
      ),
    ).toBe(true);
  }
  for (let i = 1; i < cities.length; i++) {
    expect(cities[i].height).toBeGreaterThan(cities[i - 1].height + 0.08);
    expect(
      coloredVertices(cities[i].parts[0].mesh, PALETTE.mint).length,
    ).toBeGreaterThan(
      coloredVertices(cities[i - 1].parts[0].mesh, PALETTE.mint).length,
    );
  }
});

it.each(["wind", "offshore-wind"] as const)(
  "gives %s a thick root, broad inner chord and swept, tapered airfoil sections",
  (kind) => {
    const rotor = getStructureModel(kind).parts.find(
        (p) => p.motion === "rotor",
      )!,
      root = bladeSection(rotor.mesh, 0.035),
      inner = bladeSection(rotor.mesh, 0.075),
      middle = bladeSection(rotor.mesh, 0.16),
      outer = bladeSection(rotor.mesh, 0.25);
    expect(root.depth).toBeGreaterThan(outer.depth * 3);
    expect(inner.chord).toBeGreaterThan(root.chord);
    expect(inner.chord).toBeGreaterThan(middle.chord);
    expect(middle.chord).toBeGreaterThan(outer.chord * 2);
    expect(outer.centerX).toBeLessThan(root.centerX - 0.01);
    // The upward blade travels +X: its leading edge is rounded and its -X edge is thin.
    expect(inner.thicknessAt(0.9)).toBeGreaterThan(inner.thicknessAt(0.03) * 2);
    expect(inner.thicknessAt(0.65)).toBeGreaterThan(inner.thicknessAt(0.9));
    expect(inner.thicknessAt(0.99)).toBeLessThan(inner.thicknessAt(0.9) / 2);
    expect(rotor.castsShadow).toBe(true);
  },
);

it("shares the same blade and hub geometry between land and offshore wind", () => {
  const rotor = (kind: "wind" | "offshore-wind") =>
    getStructureModel(kind).parts.find((p) => p.motion === "rotor")!;
  expect(rotor("offshore-wind").mesh).toEqual(rotor("wind").mesh);
  expect(rotor("offshore-wind").position![1]).toBeGreaterThan(
    rotor("wind").position![1],
  );
});

it("lights the airborne wing's upper facets from above", () => {
  const mesh = getStructureModel("airborne-wind").parts[1].mesh;
  const mint = upperSurfaceNormals(mesh, PALETTE.mint);
  const forest = upperSurfaceNormals(mesh, PALETTE.forestLight);
  expect(mint.length).toBeGreaterThan(0);
  expect(forest.length).toBeGreaterThan(0);
  expect(Math.min(...mint, ...forest)).toBeGreaterThan(0.1);
});

it("retains stopped rotors and wings, but hides production-only effects without effect shadows", () => {
  for (const kind of kinds) {
    const moving = getStructureModel(kind).parts.filter((part) => part.motion);
    expect(moving.length > 0).toBe(
      !kind.startsWith("city-") && kind !== "tower",
    );
    for (const part of moving) {
      expect(part.phaseOffset ?? 0).toBeGreaterThanOrEqual(0);
      expect(part.phaseOffset ?? 0).toBeLessThan(1);
      const physical = part.motion === "rotor" || part.motion === "sway";
      expect(part.hideWhenInactive ?? false).toBe(!physical);
      expect(part.castsShadow).toBe(physical);
    }
  }
});

it.each([
  "gas",
  "gas-steam",
  "oil",
  "coal",
  "biomass",
  "nuclear",
  "geothermal",
] as const)(
  "stages %s exhaust puffs at distinct fractional-cycle offsets",
  (kind) => {
    const steam = getStructureModel(kind).parts.filter(
      (part) => part.motion === "steam",
    );
    expect(new Set(steam.map((part) => part.phaseOffset)).size).toBeGreaterThan(
      1,
    );
  },
);

it("builds three identical equally spaced tilted blue solar rows on grounded supports", () => {
  const mesh = getStructureModel("solar").parts[0].mesh;
  const points = vertices(mesh),
    topFaces: Vec3[][] = [];
  for (let i = 0; i < points.length; i += 3) {
    const blue = PALETTE.solar.every(
      (c, axis) => Math.abs(c - mesh.colors[i * 3 + axis]) < 0.000001,
    );
    if (blue && mesh.normals[i * 3 + 1] > 0.8)
      topFaces.push(points.slice(i, i + 3));
  }
  const centerZ = (face: Vec3[]) =>
    face.reduce((sum, point) => sum + point[2], 0) / face.length;
  topFaces.sort((a, b) => centerZ(a) - centerZ(b));
  const rows: Vec3[][] = [[]];
  let previous = centerZ(topFaces[0]);
  for (const face of topFaces) {
    if (centerZ(face) - previous > 0.1) rows.push([]);
    rows[rows.length - 1].push(...face);
    previous = centerZ(face);
  }
  expect(rows).toHaveLength(3);
  const centers = rows.map(
    (row) =>
      (Math.min(...row.map((v) => v[2])) + Math.max(...row.map((v) => v[2]))) /
      2,
  );
  expect(centers[1] - centers[0]).toBeCloseTo(centers[2] - centers[1], 6);
  for (const row of rows) {
    expect(
      Math.max(...row.map((v) => v[0])) - Math.min(...row.map((v) => v[0])),
    ).toBeCloseTo(0.6);
    expect(
      Math.max(...row.map((v) => v[1])) - Math.min(...row.map((v) => v[1])),
    ).toBeGreaterThan(0.045);
    const center =
      (Math.min(...row.map((v) => v[2])) + Math.max(...row.map((v) => v[2]))) /
      2;
    expect(
      vertices(mesh).some(
        ([x, y, z]) =>
          Math.abs(x) > 0.2 && y < 0.001 && Math.abs(z - center) < 0.07,
      ),
    ).toBe(true);
  }
});

it("gives hydro raised reservoir water, a low downstream spillway, and a bowed thick crest", () => {
  const { parts } = getStructureModel("hydro");
  const mesh = parts[0].mesh;
  const reservoir = coloredVertices(
    parts.find(({ material }) => material === "water")!.mesh,
    PALETTE.water,
  );
  const spillway = coloredVertices(mesh, PALETTE.deepWater);
  expect(Math.min(...reservoir.map((v) => v[1]))).toBeGreaterThan(0.25);
  expect(Math.min(...spillway.map((v) => v[1]))).toBeLessThan(0.08);
  expect(Math.max(...spillway.map((v) => v[1]))).toBeGreaterThan(0.28);
  expect(
    Math.min(...upperSurfaceNormals(mesh, PALETTE.deepWater)),
  ).toBeGreaterThan(0.1);
  const points = vertices(mesh),
    crest: Vec3[] = [];
  for (let i = 0; i < points.length; i += 3) {
    const triangle = points.slice(i, i + 3);
    // The crest is inside the two end anchors, whose top faces extend farther out.
    if (
      triangle.every(
        ([x, y]) => Math.abs(y - 0.32) < 0.000001 && Math.abs(x) < 0.321,
      )
    )
      crest.push(...triangle);
  }
  const centerFront = Math.max(
    ...crest.filter((v) => Math.abs(v[0]) < 0.01).map((v) => v[2]),
  );
  const edgeFront = Math.max(
    ...crest
      .filter((v) => Math.abs(Math.abs(v[0]) - 0.32) < 0.000001)
      .map((v) => v[2]),
  );
  expect(centerFront - edgeFront).toBeGreaterThan(0.1);
  expect(
    crest.some((v) => Math.abs(v[0]) < 0.01 && v[2] < centerFront - 0.05),
  ).toBe(true);
});

it("authors facade glazing separately without turning panels, rotors or cabinets into windows", () => {
  const facades: readonly StructureKind[] = [
    "gas",
    "gas-steam",
    "oil",
    "coal",
    "biomass",
    "nuclear",
    "hydro",
    "geothermal",
    "pumped-hydro",
    "airborne-wind",
  ];
  for (const kind of kinds) {
    const parts = getStructureModel(kind).parts;
    const glazing = parts.filter((part) => part.material === "facility-window");
    expect(glazing.length).toBe(facades.includes(kind) ? 1 : 0);
    for (const part of glazing) {
      expect(part.motion).toBeUndefined();
      expect(part.hideWhenInactive).toBeUndefined();
      expect(part.castsShadow).toBe(false);
    }
    const quiet = kind.startsWith("city-") || kind === "tower";
    expect(parts.every((part) => part.material === undefined)).toBe(quiet);
  }
});
