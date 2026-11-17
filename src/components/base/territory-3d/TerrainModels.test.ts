import type { TerrainType } from "../../../Types";
import { HEX_NEIGHBORS, riverPorts } from "../TerritoryHexGeometry";
import { GROUND_RADIUS, tilePosition3D } from "./Projection";
import { getTerrainModel } from "./TerrainModels";
import type { MapMesh, MapModel, Vec3 } from "./Types";

const TERRAINS: readonly TerrainType[] = [
  "plains",
  "forest",
  "hills",
  "mountain",
  "river",
  "lake",
  "ocean",
];
const EPSILON = 1e-6;
const CORNERS: readonly Vec3[] = [
  [0, 0, -GROUND_RADIUS],
  [0.5, 0, -GROUND_RADIUS / 2],
  [0.5, 0, GROUND_RADIUS / 2],
  [0, 0, GROUND_RADIUS],
  [-0.5, 0, GROUND_RADIUS / 2],
  [-0.5, 0, -GROUND_RADIUS / 2],
];

function triangles(mesh: MapMesh): Vec3[][] {
  const result: Vec3[][] = [];
  for (let i = 0; i < mesh.positions.length; i += 9)
    result.push(
      [0, 3, 6].map((offset): Vec3 => [
        mesh.positions[i + offset],
        mesh.positions[i + offset + 1],
        mesh.positions[i + offset + 2],
      ]),
    );
  return result;
}

function projectedArea(polygon: readonly Vec3[]) {
  let area = 0;
  polygon.forEach((a, index) => {
    const b = polygon[(index + 1) % polygon.length];
    area += a[0] * b[2] - a[2] * b[0];
  });
  return Math.abs(area) / 2;
}

/** Intersect the actual triangles with the open pad; checking only vertices misses crossing faces. */
function insidePad(triangle: readonly Vec3[], halfWidth: number) {
  let polygon = triangle;
  for (const [axis, sign] of [
    [0, 1],
    [0, -1],
    [2, 1],
    [2, -1],
  ] as const) {
    const clipped: Vec3[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i],
        b = polygon[(i + 1) % polygon.length];
      const da = halfWidth - EPSILON - a[axis] * sign;
      const db = halfWidth - EPSILON - b[axis] * sign;
      const insideA = da >= 0,
        insideB = db >= 0;
      if (insideA) clipped.push(a);
      if (insideA !== insideB) {
        const t = da / (da - db);
        clipped.push([
          a[0] + (b[0] - a[0]) * t,
          a[1] + (b[1] - a[1]) * t,
          a[2] + (b[2] - a[2]) * t,
        ]);
      }
    }
    polygon = clipped;
  }
  return polygon;
}

function waterTriangles(model: MapModel) {
  const floor = model.parts[0].mesh;
  return triangles(floor).filter(
    (triangle, index) =>
      triangle.every((p) => Math.abs(p[1]) < EPSILON) &&
      // The shared cyan water palette is distinct from neutral rock and green turf.
      floor.colors[index * 9 + 2] - floor.colors[index * 9] > 0.2,
  );
}

function edgeWater(model: MapModel, edge: number): Vec3[] {
  const a = CORNERS[edge],
    b = CORNERS[(edge + 1) % 6];
  const distance = (p: Vec3) =>
    (b[0] - a[0]) * (p[2] - a[2]) - (b[2] - a[2]) * (p[0] - a[0]);
  const unique = new Map<string, Vec3>();
  waterTriangles(model)
    .flat()
    .forEach((p) => {
      if (Math.abs(distance(p)) < EPSILON)
        unique.set(p.map((n) => n.toFixed(6)).join(","), p);
    });
  return [...unique.values()];
}

it.each(TERRAINS)(
  "builds %s as a solid tile with a level floor and separate shadow casters",
  (terrain) => {
    const model = getTerrainModel(terrain);
    expect(model.key).toMatch(new RegExp(`^terrain:${terrain}:`));
    expect(model.footprint).toBe(1);
    expect(model.terminals).toEqual([]);
    expect(model.parts[0]).toMatchObject({
      castsShadow: false,
      receivesShadow: true,
    });
    const floor = model.parts[0].mesh;
    const faces = triangles(floor);
    expect(faces.some((face) => face.every((p) => p[1] < -0.05))).toBe(true);
    expect(
      faces.some(
        (face) =>
          face.some((p) => p[1] === 0) && face.some((p) => p[1] < -0.05),
      ),
    ).toBe(true);
    const top = faces.filter((face) => face.every((p) => p[1] === 0));
    expect(top.reduce((sum, face) => sum + projectedArea(face), 0)).toBeCloseTo(
      Math.sqrt(3) / 2,
      6,
    );
    expect(
      Math.max(...Array.from(floor.positions).filter((_p, i) => i % 3 === 1)),
    ).toBe(0);
    model.parts.slice(1).forEach((part) => {
      expect(part).toMatchObject({ castsShadow: true, receivesShadow: false });
      expect(part.motion).toBeUndefined();
    });
    const heights = model.parts.flatMap((part) =>
      Array.from(part.mesh.positions).filter((_p, i) => i % 3 === 1),
    );
    expect(model.height).toBeCloseTo(Math.max(...heights), 6);
  },
);

it("keeps every terrain mesh finite, flat shaded and inside its own ground hex", () => {
  for (const terrain of TERRAINS) {
    for (const { mesh } of getTerrainModel(terrain).parts) {
      expect(mesh.positions.length % 9).toBe(0);
      expect(mesh.normals).toHaveLength(mesh.positions.length);
      expect(mesh.colors).toHaveLength(mesh.positions.length);
      expect(
        [...mesh.positions, ...mesh.normals, ...mesh.colors].every(
          Number.isFinite,
        ),
      ).toBe(true);
      for (let i = 0; i < mesh.positions.length; i += 3) {
        const x = mesh.positions[i],
          z = mesh.positions[i + 2];
        expect(Math.abs(x)).toBeLessThanOrEqual(0.5 + EPSILON);
        expect(Math.abs(z) + Math.abs(x) / Math.sqrt(3)).toBeLessThanOrEqual(
          GROUND_RADIUS + EPSILON,
        );
        expect(
          Math.hypot(mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2]),
        ).toBeCloseTo(1, 5);
      }
      for (let i = 0; i < mesh.normals.length; i += 9) {
        expect(Array.from(mesh.normals.slice(i, i + 3))).toEqual(
          Array.from(mesh.normals.slice(i + 3, i + 6)),
        );
        expect(Array.from(mesh.normals.slice(i, i + 3))).toEqual(
          Array.from(mesh.normals.slice(i + 6, i + 9)),
        );
      }
    }
  }
});

it.each([0, 0.6, 0.8, 1.01])(
  "reserves the entire central square for a %s-wide occupant",
  (footprint) => {
    for (const terrain of TERRAINS) {
      const model = getTerrainModel(terrain, { footprint });
      const halfWidth = Math.max(0.55, footprint) / 2;
      for (const part of model.parts.slice(1))
        for (const triangle of triangles(part.mesh)) {
          const overlap = insidePad(triangle, halfWidth);
          const intersects =
            projectedArea(overlap) > 1e-10 &&
            overlap.some((p) => p[1] > EPSILON);
          expect({ terrain, intersects }).toEqual({
            terrain,
            intersects: false,
          });
        }
    }
  },
);

it("retains recognizable forest, hill and mountain volume beside a wide building pad", () => {
  expect(getTerrainModel("forest", { footprint: 0.8 }).height).toBeGreaterThan(
    0.25,
  );
  expect(getTerrainModel("hills", { footprint: 0.8 }).height).toBeGreaterThan(
    0.1,
  );
  expect(
    getTerrainModel("mountain", { footprint: 0.8 }).height,
  ).toBeGreaterThan(0.3);
  expect(getTerrainModel("mountain").height).toBeGreaterThan(
    getTerrainModel("hills").height * 2,
  );
  expect(
    getTerrainModel("forest", { footprint: 0.8 }).parts[1].mesh.positions
      .length,
  ).toBeLessThan(getTerrainModel("forest").parts[1].mesh.positions.length);
});

it("keeps opaque water level, lake water enclosed and ocean water continuous at every edge", () => {
  for (const terrain of ["river", "lake", "ocean"] as const) {
    expect(waterTriangles(getTerrainModel(terrain)).length).toBeGreaterThan(0);
    expect(
      waterTriangles(getTerrainModel(terrain))
        .flat()
        .every((p) => p[1] === 0),
    ).toBe(true);
  }
  for (let edge = 0; edge < 6; edge++) {
    expect(edgeWater(getTerrainModel("lake"), edge)).toHaveLength(0);
    expect(edgeWater(getTerrainModel("ocean"), edge)).toHaveLength(2);
  }
  expect(getTerrainModel("lake").height).toBeGreaterThan(0.02);
  expect(getTerrainModel("river").height).toBeGreaterThan(0.02);
});

it("opens precisely the requested river edges for every bounded port mask", () => {
  for (let mask = 0; mask < 64; mask++) {
    const ports = [0, 1, 2, 3, 4, 5].filter((edge) => mask & (1 << edge));
    const model = getTerrainModel("river", { ports });
    for (let edge = 0; edge < 6; edge++) {
      const section = edgeWater(model, edge);
      expect(section).toHaveLength(mask & (1 << edge) ? 2 : 0);
      const width = section.length
        ? Math.hypot(
            section[0][0] - section[1][0],
            section[0][2] - section[1][2],
          )
        : 0;
      expect(width).toBeCloseTo(mask & (1 << edge) ? 0.18 : 0, 6);
    }
  }
});

it("joins the actual reciprocal river ports at identical world-space water cross-sections", () => {
  for (const [edge, [q, r]] of HEX_NEIGHBORS.entries()) {
    const a = { id: "a", q: 0, r: 0, terrain: "river" };
    const b = { id: "b", q, r, terrain: "river" };
    const offset = tilePosition3D(b);
    const first = edgeWater(
      getTerrainModel("river", { ports: riverPorts(a, [a, b]) }),
      edge,
    );
    const second = edgeWater(
      getTerrainModel("river", { ports: riverPorts(b, [a, b]) }),
      (edge + 3) % 6,
    );
    const rounded = (points: Vec3[], translation: Vec3) =>
      points
        .map((p) =>
          p.map((v, i) => Number((v + translation[i]).toFixed(6))).join(","),
        )
        .sort();
    expect(rounded(first, [0, 0, 0])).toEqual(rounded(second, offset));
  }
});

it("canonicalizes repeated options into a bounded cache without leaking tile variants", () => {
  expect(getTerrainModel("forest", { footprint: 0.1 })).toBe(
    getTerrainModel("forest", { footprint: 0.55 }),
  );
  expect(getTerrainModel("forest", { footprint: 0.56 })).toBe(
    getTerrainModel("forest", { footprint: 0.65 }),
  );
  expect(getTerrainModel("forest", { footprint: 0.651 })).toBe(
    getTerrainModel("forest", { footprint: 0.8 }),
  );
  expect(getTerrainModel("forest", { footprint: 0.801 })).toBe(
    getTerrainModel("forest", { footprint: 100 }),
  );
  expect(getTerrainModel("river")).toBe(
    getTerrainModel("river", { ports: [3, 0, 3, -1, 6, 0.5, NaN] }),
  );
  expect(getTerrainModel("lake", { ports: [1] })).toBe(
    getTerrainModel("lake", { ports: [2, 5] }),
  );
  const models = new Set<MapModel>();
  for (const terrain of TERRAINS)
    for (const footprint of [0, 0.6, 0.7, 0.9])
      for (let mask = 0; mask < 64; mask++) {
        const ports = [0, 1, 2, 3, 4, 5].filter((edge) => mask & (1 << edge));
        models.add(getTerrainModel(terrain, { footprint, ports }));
      }
  expect(models.size).toBe(280);
  const continuousVariants = new Set<MapModel>();
  for (let i = 0; i <= 1000; i++)
    continuousVariants.add(
      getTerrainModel("forest", { footprint: i / 1000, ports: [i] }),
    );
  expect(continuousVariants.size).toBe(4);
});
