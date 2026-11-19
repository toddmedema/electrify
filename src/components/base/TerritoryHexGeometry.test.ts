import {
  HEX_HEIGHT,
  HEX_WIDTH,
  hexBoundary,
  hexCenter,
  hexWires,
  foregroundOrigin,
  groundAnchor,
  occupantTerminal,
  TOWER_ART_TRANSFORM,
  TOWER_CROSSARM,
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
  expect(
    origin.y +
      ((TOWER_ART_TRANSFORM.y + TOWER_CROSSARM.y * TOWER_ART_TRANSFORM.scale) *
        HEX_WIDTH) /
        500,
  ).toBeCloseTo(occupantTerminal(center).y);
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
      expect(wire.kind).toBe("overhead");
      expect(wire.path.match(/[MQL]/g)).toEqual(["M", "Q"]);
      const chordY = (wire.start.y + wire.end.y) / 2;
      const midpointY = (wire.start.y + 2 * wire.control!.y + wire.end.y) / 4;
      const groundY =
        (groundAnchor(tiles.find((tile) => tile.id === wire.from)!).y +
          groundAnchor(tiles.find((tile) => tile.id === wire.to)!).y) /
        2;
      expect(midpointY).toBeGreaterThan(chordY);
      expect(midpointY).toBeLessThan(groundY);
    }
  },
);
it("attaches each land span to the facing crossarm rather than the tower footing", () => {
  const [wire] = hexWires([center, around[1]], () => true);
  const left = wire.from === center.id ? center : around[1];
  const right = wire.to === around[1].id ? around[1] : center;
  expect(wire.start).toEqual(occupantTerminal(left, "tower", right));
  expect(wire.end).toEqual(occupantTerminal(right, "tower", left));
  const tower = occupantTerminal(center, "tower", around[1]);
  expect(tower.x).toBeGreaterThan(groundAnchor(center).x);
  expect(tower.y).toBeLessThan(groundAnchor(center).y - 20);
  const back = occupantTerminal(center, "tower", around[4]);
  expect(back.x).toBeLessThan(groundAnchor(center).x);
  expect(back.y).toBe(tower.y);
});
it.each(["city", "generator", "hydro", "storage"] as const)(
  "terminates at the elevated %s facade with a suspended rather than ground path",
  (structure) => {
    const [wire] = hexWires(
      [center, around[1]],
      () => true,
      () => true,
      () => structure,
    );
    expect(wire.kind).toBe("overhead");
    expect(wire.start.y).toBeLessThan(groundAnchor(center).y);
    expect(wire.end.y).toBeLessThan(groundAnchor(around[1]).y);
    expect(wire.control!.y).toBeGreaterThan((wire.start.y + wire.end.y) / 2);
  },
);
it("uses a submerged cable across empty water without an imaginary elevated support", () => {
  const [wire] = hexWires(
    [center, around[1]],
    () => true,
    () => true,
    (tile) => (tile.id === center.id ? "tower" : "submerged"),
  );
  expect(wire.kind).toBe("submerged");
  expect(wire.control).toBeUndefined();
  expect(wire.start).toEqual(groundAnchor(center));
  expect(wire.end).toEqual(groundAnchor(around[1]));
  expect(wire.path.match(/[MQL]/g)).toEqual(["M", "L"]);
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
