import { HEX_NEIGHBORS } from "../TerritoryHexGeometry";
import { coastStyle, getCoastModel, type CoastStyle } from "./CoastModels";
import { GROUND_HEX_CORNERS as HEX, tilePosition3D } from "./Projection";
import type { MapModel } from "./Types";

const key = ([x, y, z]: readonly number[]) =>
  [x, y, z].map((n) => n.toFixed(4)).join(",");

/** World-space vertices lying on the board line through two ground points. */
function onLine(
  model: MapModel,
  origin: readonly number[],
  [ax, az]: readonly number[],
  [bx, bz]: readonly number[],
) {
  const points = new Set<string>();
  const { positions } = model.parts[0].mesh;
  const length = Math.hypot(bx - ax, bz - az);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] + origin[0],
      z = positions[i + 2] + origin[2];
    const across = ((x - ax) * (bz - az) - (z - az) * (bx - ax)) / length;
    if (Math.abs(across) < 1e-5) points.add(key([x, positions[i + 1], z]));
  }
  return points;
}

describe.each(["beach", "strand", "cliff"] as CoastStyle[])(
  "%s trims",
  (style) => {
    it.each([0, 1, 2, 3, 4, 5])(
      "continue across the land edge two tiles share beside the sea (edge %i)",
      (edge) => {
        // Tile A faces the sea across `edge`; its next neighbour B is land facing the same sea.
        const [oq, or] = HEX_NEIGHBORS[edge];
        const [bq, br] = HEX_NEIGHBORS[(edge + 1) % 6];
        const towardSea = HEX_NEIGHBORS.findIndex(
          ([q, r]) => q === oq - bq && r === or - br,
        );
        const a = getCoastModel(style, 1 << edge);
        const b = getCoastModel(style, 1 << towardSea);
        const originA = tilePosition3D({ q: 0, r: 0 });
        const originB = tilePosition3D({ q: bq, r: br });
        // The shared land edge runs from A's corner edge + 1 to corner edge + 2.
        const start = HEX[(edge + 1) % 6],
          end = HEX[(edge + 2) % 6];
        const fromA = onLine(a, originA, start, end);
        const fromB = onLine(b, originB, start, end);
        expect(fromA.size).toBeGreaterThan(2);
        expect([...fromA].sort()).toEqual([...fromB].sort());
      },
    );

    it("mitres two sea-facing edges of one tile without a gap", () => {
      // Split the corner's triangles by side of its bisector: each band must
      // reach the bisector with the same profile points.
      const [cx, cz] = HEX[1];
      const { positions } = getCoastModel(style, 0b11).parts[0].mesh;
      const sides = [new Set<string>(), new Set<string>()];
      for (let i = 0; i < positions.length; i += 9) {
        const side = (x: number, z: number) => x * cz - z * cx;
        const centroid = side(
          positions[i] + positions[i + 3] + positions[i + 6],
          positions[i + 2] + positions[i + 5] + positions[i + 8],
        );
        for (let v = i; v < i + 9; v += 3)
          if (Math.abs(side(positions[v], positions[v + 2])) < 1e-5)
            sides[centroid > 0 ? 0 : 1].add(
              key(Array.from(positions.slice(v, v + 3))),
            );
      }
      expect(sides[0].size).toBeGreaterThan(2);
      expect([...sides[0]].sort()).toEqual([...sides[1]].sort());
    });
  },
);

it("keeps beaches between farm fields and the projected shadow plane", () => {
  const { positions } = getCoastModel("beach", 63).parts[0].mesh;
  for (let i = 1; i < positions.length; i += 3)
    expect(positions[i]).toBeLessThanOrEqual(0.0025);
  expect(Math.max(...positions.filter((_, i) => i % 3 === 1))).toBeCloseTo(
    0.0025,
    6,
  );
});

it("raises cliffs on high ground and keeps wide facility pads level", () => {
  expect(coastStyle("mountain", 0, 0)).toBe("cliff");
  expect(coastStyle("hills", 0, 0)).toBe("cliff");
  expect(coastStyle("river", 0, 0)).toBe("beach");
  expect(coastStyle("mountain", 0, 0.8)).toBe("strand");
  expect(coastStyle("plains", 0, 0)).toBe("cliff");
  expect(coastStyle("plains", 1 << 24, 0)).toBe("beach");
  expect(getCoastModel("cliff", 5)).toBe(getCoastModel("cliff", 5));
});
