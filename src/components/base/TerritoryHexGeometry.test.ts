import { hexWires, riverPorts } from "./TerritoryHexGeometry";
const center = { id: "center", q: 0, r: 0, developed: true, owner: "you" };
const around = [
  [1, -1],
  [1, 0],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [0, -1],
].map(([q, r], i) => ({ ...center, id: `neighbor-${i}`, q, r }));
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
    expect(wires.map(({ id }) => id).sort()).toEqual(
      expectedPairs
        .map((pair) =>
          pair
            .map(({ id }) => id)
            .sort()
            .join("|"),
        )
        .sort(),
    );
    expect(wires.every(({ kind }) => kind === "overhead")).toBe(true);
  },
);
it("uses a submerged cable across developed open water", () => {
  const [wire] = hexWires(
    [center, around[1]],
    () => true,
    undefined,
    (tile) => tile.id === around[1].id,
  );
  expect(wire.kind).toBe("submerged");
});
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
it("joins river ports reciprocally without opening an enclosed lake", () => {
  const river = { ...center, terrain: "river" };
  const next = { ...around[0], terrain: "river" };
  const lake = { ...around[1], terrain: "lake" };
  expect(riverPorts(river, [river, next, lake])).toEqual([0]);
  expect(riverPorts(next, [river, next, lake])).toEqual([3]);
});
