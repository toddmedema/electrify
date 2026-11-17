import { hexCenter } from "../TerritoryHexGeometry";
import { MeshBuilder } from "./MeshBuilder";
import { projectPoint, projectionMatrix, tilePosition3D } from "./Projection";
import { PALETTE } from "./Palette";
import type { MapFrame, MapMesh } from "./Types";

const frame: MapFrame = {
  width: 390,
  height: 720,
  dpr: 1,
  cameraX: -250,
  cameraY: 110,
  scale: 0.75,
  background: [0, 0, 0],
  lighting: {
    direction: [0, 1, 0],
    color: [1, 1, 1],
    ambient: 0.5,
    shadow: 0.2,
  },
  visible: true,
  motionAllowed: true,
  playbackRate: 0.7,
};
function expectValidMesh(mesh: MapMesh) {
  expect(mesh.positions.length).toBeGreaterThan(0);
  expect(mesh.positions.length % 9).toBe(0);
  expect(mesh.normals).toHaveLength(mesh.positions.length);
  expect(mesh.colors).toHaveLength(mesh.positions.length);
  expect(
    [...mesh.positions, ...mesh.normals, ...mesh.colors].every(Number.isFinite),
  ).toBe(true);
  for (let i = 0; i < mesh.normals.length; i += 3)
    expect(
      Math.hypot(mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2]),
    ).toBeCloseTo(1, 5);
}
it("keeps 3D ground aligned with existing map targets across camera positions", () => {
  for (const tile of [
    { q: -4, r: -4 },
    { q: 0, r: 0 },
    { q: 150, r: -75 },
  ]) {
    const existing = hexCenter(tile),
      actual = projectPoint(tilePosition3D(tile), frame);
    expect(actual.x).toBeCloseTo(
      frame.width / 2 + (existing.x - frame.cameraX) * frame.scale,
      8,
    );
    expect(actual.y).toBeCloseTo(
      frame.height / 2 + (existing.y - frame.cameraY) * frame.scale,
      8,
    );
  }
});
it("uses the same projection for GPU vertices and upright model height", () => {
  const m = projectionMatrix(frame);
  for (const point of [
    [0, 0, 0],
    [0.25, 0.8, -0.4],
    [-5, 0.35, 3],
  ] as const) {
    const actual = projectPoint(point, frame);
    const x = m[0] * point[0] + m[4] * point[1] + m[8] * point[2] + m[12];
    const y = m[1] * point[0] + m[5] * point[1] + m[9] * point[2] + m[13];
    expect(((x + 1) * frame.width) / 2).toBeCloseTo(actual.x, 3);
    expect(((1 - y) * frame.height) / 2).toBeCloseTo(actual.y, 3);
  }
  expect(projectPoint([0, 0.8, 0], frame).y).toBeLessThan(
    projectPoint([0, 0, 0], frame).y,
  );
});
it("builds closed boxes and cones with finite, unit flat normals", () => {
  const box = new MeshBuilder()
    .box([0, 0.2, 0], [0.6, 0.4, 0.5], PALETTE.cream)
    .build();
  expectValidMesh(box);
  expect(box.positions.length / 9).toBe(12);
  expectValidMesh(
    new MeshBuilder()
      .cylinder([0, 0, 0], 0.2, 0, 0.5, PALETTE.forest, 5)
      .build(),
  );
  expectValidMesh(
    new MeshBuilder()
      .cylinder([0, 0, 0], 0, 0.2, 0.5, PALETTE.forest, 5)
      .build(),
  );
});
it("preserves physical dimensions and normals when placing a rotated scaled mesh", () => {
  const source = new MeshBuilder()
    .box([0, 0, 0], [1, 1, 1], PALETTE.steel)
    .build();
  const placed = new MeshBuilder()
    .merge(source, [2, 3, 4], [0, Math.PI / 2, 0], [2, 1, 0.5])
    .build();
  expectValidMesh(placed);
  const axis = (i: number) =>
    Array.from(placed.positions).filter((_v, index) => index % 3 === i);
  expect(Math.min(...axis(0))).toBeCloseTo(1.75);
  expect(Math.max(...axis(0))).toBeCloseTo(2.25);
  expect(Math.min(...axis(2))).toBeCloseTo(3);
  expect(Math.max(...axis(2))).toBeCloseTo(5);
});
it("builds a finite three-dimensional conductor between elevated terminals", () => {
  const mesh = new MeshBuilder()
    .beam([-0.3, 0.5, 0], [0.3, 0.35, 0.5], 0.005, PALETTE.ink)
    .build();
  expectValidMesh(mesh);
  expect(
    Math.min(...Array.from(mesh.positions).filter((_v, i) => i % 3 === 1)),
  ).toBeGreaterThan(0.3);
});
