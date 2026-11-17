import { PALETTE } from "./Palette";
import { getStructureModel } from "./StructureModels";
import type { MapMesh, ModelPart, RGB, StructureKind, Vec3 } from "./Types";

// The union owns the inventory: adding a kind requires giving it these contracts.
const inventory: Record<StructureKind, true> = {
  residential: true,
  "industrial-city": true,
  tower: true,
  solar: true,
  wind: true,
  "offshore-wind": true,
  "airborne-wind": true,
  gas: true,
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

/** Contract poses sampled independently of factory metadata, including end-of-steam-cycle. */
function posed(part: ModelPart, point: Vec3, cycle: number): Vec3 {
  let [x, y, z] = point;
  const phase = (cycle + (part.phaseOffset ?? 0)) * Math.PI * 2;
  const angle =
    part.motion === "rotor"
      ? phase
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

describe.each(kinds)("%s model", (kind) => {
  it("caches solid finite geometry with a bounded map-scale triangle count", () => {
    const model = getStructureModel(kind);
    expect(getStructureModel(kind)).toBe(model);
    expect(model.key).toBe(`structure:${kind}`);
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
    const model = getStructureModel(kind);
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
    const model = getStructureModel(kind);
    const body = vertices(model.parts[0].mesh);
    expect(model.terminals).toHaveLength(2);
    for (const terminal of model.terminals) {
      expect(terminal[1]).toBeGreaterThan(0.1);
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

it("keeps the empty-land tower small and quiet", () => {
  const model = getStructureModel("tower");
  expect(model.footprint).toBeLessThan(0.2);
  expect(model.height).toBeLessThan(0.32);
  expect(coloredVertices(model.parts[0].mesh, PALETTE.ink)).toHaveLength(0);
  expect(coloredVertices(model.parts[0].mesh, PALETTE.mint)).toHaveLength(0);
});

it("lights the airborne wing's upper facets from above", () => {
  const mesh = getStructureModel("airborne-wind").parts[1].mesh;
  expect(
    Math.min(
      ...upperSurfaceNormals(mesh, PALETTE.mint),
      ...upperSurfaceNormals(mesh, PALETTE.forestLight),
    ),
  ).toBeGreaterThan(0.1);
});

it("retains stopped rotors and wings, but hides production-only effects without effect shadows", () => {
  for (const kind of kinds) {
    const moving = getStructureModel(kind).parts.filter((part) => part.motion);
    expect(moving.length > 0).toBe(
      !["residential", "industrial-city", "tower"].includes(kind),
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

it.each(["gas", "oil", "coal", "biomass", "nuclear", "geothermal"] as const)(
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
  const mesh = getStructureModel("hydro").parts[0].mesh;
  const reservoir = coloredVertices(mesh, PALETTE.water);
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
