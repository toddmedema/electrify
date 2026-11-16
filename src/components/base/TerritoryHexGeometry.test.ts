import {
  HEX_HEIGHT,
  HEX_WIDTH,
  hexBoundary,
  hexCenter,
  hexWires,
  foregroundOrigin,
  groundAnchor,
  occupantTerminal,
  riverPorts,
} from "./TerritoryHexGeometry";
const center = { id: "center", q: 0, r: 0, developed: true, owner: "you" };
const around = [
  [1, -1],
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
].map(([q, r], i) => ({ ...center, id: `neighbor-${i}`, q, r }));
it("projects a uniformly scaled foreground onto the terrain anchor", () => {
  const origin = foregroundOrigin(center);
  expect(origin.x + (250 * HEX_WIDTH) / 500).toBeCloseTo(
    groundAnchor(center).x,
  );
  expect(origin.y + (365 * HEX_WIDTH) / 500).toBeCloseTo(
    groundAnchor(center).y,
  );
  expect(origin.y + (350 * HEX_WIDTH) / 500).toBeCloseTo(
    occupantTerminal(center).y,
  );
  expect(HEX_HEIGHT / HEX_WIDTH).toBeCloseTo(0.72);
});
it.each(Array.from({ length: 64 }, (_, i) => i))(
  "connects every developed adjacency once for neighbor mask %i",
  (mask) => {
    const tiles = [
      center,
      ...around.map((tile, i) => ({ ...tile, developed: !!(mask & (1 << i)) })),
    ];
    const wires = hexWires(tiles, (tile) => tile.developed);
    const active = tiles.filter((tile) => tile.developed);
    const expectedPairs = active.flatMap((a, index) =>
      active
        .slice(index + 1)
        .filter(
          (b) =>
            Math.max(
              Math.abs(a.q - b.q),
              Math.abs(a.r - b.r),
              Math.abs(a.q + a.r - b.q - b.r),
            ) === 1,
        )
        .map((b) => [a, b]),
    );
    expect(wires).toHaveLength(expectedPairs.length);
    expect(new Set(wires.map((wire) => wire.id)).size).toBe(wires.length);
    expect(hexWires([...tiles].reverse(), (tile) => tile.developed)).toEqual(
      wires,
    );
    for (const wire of wires) {
      const a = hexCenter(tiles.find((tile) => tile.id === wire.from)!);
      const b = hexCenter(tiles.find((tile) => tile.id === wire.to)!);
      expect(wire.crossing).toEqual({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      expect(wire.path.match(/[ML]/g)).toHaveLength(5);
    }
  },
);
it("does not connect across a company boundary or to undeveloped land", () => {
  const other = { ...around[0], owner: "neighbor" };
  expect(
    hexWires(
      [center, other],
      () => true,
      (a, b) => a.owner === b.owner,
    ),
  ).toEqual([]);
  expect(hexWires([center, other], (tile) => tile.id === "center")).toEqual([]);
});
it("merges ownership borders while leaving exposed edges", () => {
  expect(hexBoundary([center], () => true).match(/M/g)).toHaveLength(6);
  expect(hexBoundary([center, around[0]], () => true).match(/M/g)).toHaveLength(
    10,
  );
});
it("joins river ports reciprocally without opening an enclosed lake", () => {
  const river = { ...center, terrain: "river" };
  const next = { ...around[0], terrain: "river" };
  const lake = { ...around[1], terrain: "lake" };
  expect(riverPorts(river, [river, next, lake])).toEqual([0]);
  expect(riverPorts(next, [river, next, lake])).toEqual([3]);
});
