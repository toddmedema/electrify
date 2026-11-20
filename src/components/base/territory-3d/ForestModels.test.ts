import { GROUND_RADIUS } from "./Projection";
import { getTerrainModel } from "./TerrainModels";
import type { MapModel, Vec3 } from "./Types";

const corners: readonly Vec3[] = [
  [0, 0, -GROUND_RADIUS],
  [0.5, 0, -GROUND_RADIUS / 2],
  [0.5, 0, GROUND_RADIUS / 2],
  [0, 0, GROUND_RADIUS],
  [-0.5, 0, GROUND_RADIUS / 2],
  [-0.5, 0, -GROUND_RADIUS / 2],
];

function outsideEdges(model: MapModel) {
  const edges = new Set<number>();
  for (const part of model.parts.filter(({ castsShadow }) => castsShadow)) {
    const { positions } = part.mesh;
    const [x, , z] = part.position ?? [0, 0, 0];
    for (let vertex = 0; vertex < positions.length; vertex += 3)
      corners.forEach((a, edge) => {
        const b = corners[(edge + 1) % 6];
        const cross =
          (b[0] - a[0]) * (positions[vertex + 2] + z - a[2]) -
          (b[2] - a[2]) * (positions[vertex] + x - a[0]);
        if (cross < -1e-6) edges.add(edge);
      });
  }
  return edges;
}

it("keeps forest crowns within exterior edges and crosses each shared edge only when another forest meets it", () => {
  expect(outsideEdges(getTerrainModel("forest"))).toEqual(new Set());
  for (let edge = 0; edge < 6; edge++)
    expect(
      outsideEdges(getTerrainModel("forest", { adjacentEdges: 1 << edge })),
    ).toEqual(new Set([edge]));
});

it("keeps more trees on untouched forest than beside a pylon or a facility", () => {
  const [untouched, pylon, facility] = [0, 0.17, 0.65].map((footprint) =>
    getTerrainModel("forest", { footprint })
      .parts.filter(({ castsShadow }) => castsShadow)
      .reduce((sum, { mesh }) => sum + mesh.positions.length / 9, 0),
  );
  expect(untouched).toBeGreaterThan(pylon);
  expect(pylon).toBeGreaterThan(facility);
  expect(facility).toBeGreaterThan(0);
});

it("shares dry canopy geometry and replaces burned crowns with fewer, shorter snags", () => {
  const green = getTerrainModel("forest", { adjacentEdges: 1 });
  const dry = getTerrainModel("forest", { adjacentEdges: 1, weather: "dry" });
  const parched = getTerrainModel("forest", {
    adjacentEdges: 1,
    weather: "parched",
  });
  const ash = getTerrainModel("forest", {
    adjacentEdges: 1,
    weather: "scorched",
  });
  expect(dry.parts[1].mesh.positions).toBe(green.parts[1].mesh.positions);
  expect(parched.parts[1].mesh.positions).toBe(green.parts[1].mesh.positions);
  expect(dry.parts[1].mesh.colors).not.toEqual(green.parts[1].mesh.colors);
  expect(parched.parts[1].mesh.colors).not.toEqual(dry.parts[1].mesh.colors);
  expect(ash.height).toBeLessThan(green.height);
  expect(ash.parts).toHaveLength(2);
  expect(ash.parts[0].mesh.colors).not.toEqual(green.parts[0].mesh.colors);
  expect(
    getTerrainModel("forest", { adjacentEdges: 1, weather: "parched" }),
  ).toBe(parched);
});
