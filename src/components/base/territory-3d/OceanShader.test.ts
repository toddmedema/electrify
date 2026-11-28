import { OCEAN_FRAGMENT } from "./OceanShader";
import { SHORE_RING_POSITIONS } from "./Shoreline";

it("tests the same ring of tiles, in the same bit order, as the shore mask", () => {
  const ring = OCEAN_FRAGMENT.match(
    /SHORE_RING\[(\d+)\] = vec2\[\]\(([^;]*)\);/,
  );
  expect(Number(ring![1])).toBe(SHORE_RING_POSITIONS.length);
  const literals = Array.from(
    ring![2].matchAll(/vec2\((-?[\d.]+), (-?[\d.]+)\)/g),
    ([, x, z]) => [Number(x), Number(z)],
  );
  expect(literals).toHaveLength(SHORE_RING_POSITIONS.length);
  literals.forEach(([x, z], bit) => {
    expect(x).toBeCloseTo(SHORE_RING_POSITIONS[bit][0], 5);
    expect(z).toBeCloseTo(SHORE_RING_POSITIONS[bit][1], 5);
  });
  expect(OCEAN_FRAGMENT).toContain(
    `for (int i = 0; i < ${SHORE_RING_POSITIONS.length}; i++)`,
  );
});
