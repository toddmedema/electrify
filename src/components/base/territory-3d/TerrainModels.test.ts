import type { TerrainType } from "../../../Types";
import { HEX_NEIGHBORS, riverPorts } from "../TerritoryHexGeometry";
import { GROUND_RADIUS, tilePosition3D } from "./Projection";
import { getTerrainModel } from "./TerrainModels";
import type { MapMesh, MapModel, ModelPart, Vec3 } from "./Types";
import { WATERSHED_LEVEL_OFFSETS } from "./WaterSurface";

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

function isWater({ material }: ModelPart) {
  return (
    material === "water" ||
    material === "watershed-water" ||
    material === "river-water"
  );
}

function waterTriangles(model: MapModel) {
  return model.parts.filter(isWater).flatMap(({ mesh }) => triangles(mesh));
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
    expect(
      [...top, ...waterTriangles(model)].reduce(
        (sum, face) => sum + projectedArea(face),
        0,
      ),
    ).toBeCloseTo(Math.sqrt(3) / 2, 6);
    // Ground decoration sits below the projected shadow plane.
    expect(Math.max(...faces.flat().map((p) => p[1]))).toBeLessThan(0.003);
    model.parts.slice(1).forEach((part) => {
      const water = isWater(part);
      expect(part).toMatchObject({
        castsShadow: !water,
        receivesShadow: water,
      });
      expect(part.motion).toBeUndefined();
    });
    const heights = model.parts.flatMap((part) =>
      Array.from(part.mesh.positions).filter((_p, i) => i % 3 === 1),
    );
    expect(model.height).toBeCloseTo(Math.max(...heights), 6);
  },
);

it.each(TERRAINS)(
  "uses one base color across level %s land and water",
  (terrain) => {
    const model = getTerrainModel(terrain);
    for (const { mesh } of model.parts.filter((part) => part.receivesShadow)) {
      const colors = new Set<string>();
      triangles(mesh).forEach((face, index) => {
        if (face.every((p) => p[1] === 0))
          colors.add(mesh.colors.slice(index * 9, index * 9 + 3).join(","));
      });
      expect(colors.size).toBeLessThanOrEqual(1);
    }
  },
);

it("keeps the rectangular field edges and crop rows on one survey grid across all four farms", () => {
  let bearing: number | undefined;
  for (let variant = 0; variant < 4; variant++) {
    const floor = getTerrainModel("plains", { variant }).parts[0].mesh;
    const farmland = triangles(floor).filter((face) =>
      face.every((p) => p[1] > 0),
    );
    expect(farmland.length).toBeGreaterThan(0);
    for (const face of farmland) {
      // The two short sides of a triangulated rectangle follow its boundaries.
      const edges = face
        .map(([x, , z], i) => {
          const next = face[(i + 1) % 3];
          return { dx: next[0] - x, dz: next[2] - z };
        })
        .sort((a, b) => Math.hypot(a.dx, a.dz) - Math.hypot(b.dx, b.dz));
      const angles = edges.slice(0, 2).map(({ dx, dz }) => Math.atan2(dz, dx));
      bearing ??= angles[0];
      expect(Math.cos(angles[0] - angles[1])).toBeCloseTo(0, 5);
      for (const angle of angles)
        expect(Math.sin(2 * (angle - bearing))).toBeCloseTo(0, 5);
    }
  }
});

it("draws four distinct farm footprints and keeps their fields and buildings clear of energy sites", () => {
  const fields = new Set<string>();
  for (let variant = 0; variant < 4; variant++) {
    const farm = getTerrainModel("plains", { variant });
    const plots = triangles(farm.parts[0].mesh).filter((face) =>
      face.every((p) => p[1] > 0),
    );
    expect(plots.length).toBeGreaterThan(0);
    fields.add(JSON.stringify(plots));
    expect(farm.height).toBeGreaterThan(0);
    for (const footprint of [0.24, 0.6, 0.7, 0.9]) {
      const occupied = getTerrainModel("plains", { variant, footprint });
      for (const part of occupied.parts)
        for (const face of triangles(part.mesh).filter((face) =>
          face.some((p) => p[1] > 0),
        ))
          expect(projectedArea(insidePad(face, footprint / 2))).toBeLessThan(
            1e-10,
          );
    }
  }
  expect(fields.size).toBe(4);
});

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
      if (!footprint && ["mountain", "forest", "plains"].includes(terrain))
        continue;
      const model = getTerrainModel(terrain, { footprint });
      const halfWidth = Math.max(0.55, footprint) / 2;
      for (const part of model.parts.slice(1))
        for (const triangle of triangles(part.mesh)) {
          const overlap = insidePad(triangle, halfWidth);
          const intersects =
            projectedArea(overlap) > 1e-10 &&
            overlap.some((p) => p[1] > (model.supportY ?? 0) + EPSILON);
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

it("joins all six mountain edges at the same rise across natural and graded slopes", () => {
  const edgeProfile = (model: MapModel, edge: number, offset: Vec3) => {
    const a = CORNERS[edge],
      b = CORNERS[(edge + 1) % CORNERS.length];
    return new Set(
      triangles(model.parts[1].mesh)
        .flat()
        .filter(
          (p) =>
            Math.abs(
              (b[0] - a[0]) * (p[2] - a[2]) - (b[2] - a[2]) * (p[0] - a[0]),
            ) < EPSILON,
        )
        .map((p) =>
          p.map((value, axis) => (value + offset[axis]).toFixed(6)).join(","),
        ),
    );
  };

  for (const [edge, [q, r]] of HEX_NEIGHBORS.entries()) {
    const opposite = (edge + 3) % 6;
    const natural = getTerrainModel("mountain", { adjacentEdges: 1 << edge });
    const developed = getTerrainModel("mountain", {
      footprint: 0.24,
      adjacentEdges: 1 << opposite,
    });
    const naturalEdge = edgeProfile(natural, edge, [0, 0, 0]);
    expect(naturalEdge.size).toBe(3);
    const offset = tilePosition3D({ q, r });
    const rounded = (profile: Set<string>) =>
      [...profile]
        .map((point) => point.replaceAll("-0.000000", "0.000000"))
        .sort();
    expect(rounded(naturalEdge)).toEqual(
      rounded(edgeProfile(developed, opposite, offset)),
    );
    expect([...naturalEdge].some((p) => Number(p.split(",")[1]) > 0.25)).toBe(
      true,
    );
    expect(natural.parts[0].mesh).toBe(developed.parts[0].mesh);
  }
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
});

it("opens precisely the requested river edges for every bounded port mask", () => {
  for (let mask = 0; mask < 64; mask++) {
    const ports = [0, 1, 2, 3, 4, 5].filter((edge) => mask & (1 << edge));
    const model = getTerrainModel("river", { ports });
    const dryLand = triangles(model.parts[0].mesh).filter((face) =>
      face.every(([, y]) => y === 0),
    );
    expect(
      [...dryLand, ...waterTriangles(model)].reduce(
        (area, face) => area + projectedArea(face),
        0,
      ),
    ).toBeCloseTo(Math.sqrt(3) / 2, 6);
    for (let edge = 0; edge < 6; edge++) {
      const section = edgeWater(model, edge);
      expect(section).toHaveLength(mask & (1 << edge) ? 2 : 0);
      const width = section.length
        ? Math.hypot(
            section[0][0] - section[1][0],
            section[0][2] - section[1][2],
          )
        : 0;
      expect(width).toBeCloseTo(mask & (1 << edge) ? 0.29 : 0, 6);
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

it("keeps a river crossing open even at the lowest water level", () => {
  const [lowWater] = WATERSHED_LEVEL_OFFSETS;
  for (const ports of [[1, 4], [1, 2], [1]]) {
    const model = getTerrainModel("river", { ports });
    const sharedFace = triangles(model.parts[0].mesh).filter((face) =>
      face.every(([x]) => Math.abs(x - 0.5) < EPSILON),
    );
    // Cut the exposed tile wall at the lowest water level so a tall triangle
    // across a port cannot pass merely because its vertices sit on the banks.
    const wallsAcrossChannel = sharedFace.filter((face) => {
      const crossings = face.flatMap(([, y, z], i) => {
        const [, nextY, nextZ] = face[(i + 1) % face.length];
        const belowWater = y < lowWater;
        const nextBelowWater = nextY < lowWater;
        if (belowWater === nextBelowWater) return [];
        return [z + ((lowWater - y) / (nextY - y)) * (nextZ - z)];
      });
      return Math.min(...crossings) <= 0 && Math.max(...crossings) >= 0;
    });
    expect(wallsAcrossChannel).toEqual([]);
  }
});

it("varies the in-tile channel while preserving the exact edge profiles", () => {
  const reference = getTerrainModel("river", { ports: [1, 4] });
  const beds = new Set<string>();
  for (let variant = 0; variant < 4; variant++) {
    const model = getTerrainModel("river", { ports: [1, 4], variant });
    beds.add(JSON.stringify(waterTriangles(model)));
    for (const edge of [1, 4])
      expect(edgeWater(model, edge)).toEqual(edgeWater(reference, edge));
  }
  expect(beds.size).toBe(4);
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
    for (const footprint of [0, 0.24, 0.6, 0.7, 0.9])
      for (let mask = 0; mask < 64; mask++) {
        const ports = [0, 1, 2, 3, 4, 5].filter((edge) => mask & (1 << edge));
        models.add(getTerrainModel(terrain, { footprint, ports }));
      }
  expect(models.size).toBe(282);
  expect(
    getTerrainModel("mountain", { adjacentEdges: 65, footprint: 0.27 }),
  ).toBe(getTerrainModel("mountain", { adjacentEdges: 1, footprint: 0.67 }));
  const continuousVariants = new Set<MapModel>();
  for (let i = 0; i <= 1000; i++)
    continuousVariants.add(
      getTerrainModel("forest", { footprint: i / 1000, ports: [i] }),
    );
  expect(continuousVariants.size).toBe(5);
});
