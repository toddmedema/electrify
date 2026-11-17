import type { TerritoryTileView } from "../../../helpers/TerritoryMapState";
import { hexWires } from "../TerritoryHexGeometry";
import { MeshBuilder } from "./MeshBuilder";
import { SceneBuilder, structureKind } from "./SceneBuilder";
import type { MapModel } from "./Types";

const model: MapModel = {
  key: "test-structure",
  parts: [
    {
      mesh: new MeshBuilder()
        .box([0, 0.2, 0], [0.2, 0.4, 0.2], [1, 1, 1])
        .build(),
    },
  ],
  terminals: [
    [-0.1, 0.3, 0],
    [0.1, 0.3, 0],
  ],
  footprint: 0.7,
  height: 0.4,
};
function view(q = 0): TerritoryTileView {
  return {
    tile: {
      id: q ? "green-uplands:site-2" : "green-uplands:site-1",
      territoryId: "green-uplands",
      q,
      r: 0,
      terrain: "plains",
      siteKind: "open-land",
      maxPeakW: Infinity,
    },
    owned: true,
    ownerKey: "you",
    ownerName: "You",
    developed: true,
    visibilityDistance: 0,
  };
}
function setup() {
  const terrain = jest.fn(() => model),
    structure = jest.fn(() => model);
  return {
    builder: new SceneBuilder({ terrain, structure }),
    terrain,
    structure,
  };
}
test("open water has no pylon while developed dry land has a quiet tower", () => {
  const land = view(),
    { builder, structure } = setup();
  const water = {
    ...view(1),
    tile: { ...view(1).tile, terrain: "lake" as const },
  };
  const result = builder.build(
    [land, water],
    [land.tile, water.tile],
    [],
    0,
    "run",
  );
  expect(structure).toHaveBeenCalledTimes(1);
  expect(structure).toHaveBeenCalledWith("tower");
  expect(result.map((item) => item.id)).toEqual([
    "terrain:green-uplands:site-1",
    "structure:green-uplands:site-1",
    "terrain:green-uplands:site-2",
  ]);
});
test("terrain reserves the structure footprint and unknown operation stays still", () => {
  const tile = {
    ...view(),
    facility: { name: "Solar", fuel: "Sun", peakW: 1, yearsToBuildLeft: 0 },
  } satisfies TerritoryTileView;
  const { builder, terrain } = setup();
  const result = builder.build([tile], [tile.tile], [], 0, "run");
  expect(terrain).toHaveBeenCalledWith("plains", {
    footprint: 0.7,
    ports: undefined,
  });
  expect(result[1].active).toBe(false);
  expect(structureKind(tile)).toBe("solar");
  expect(
    structureKind({ ...tile, facility: { ...tile.facility, fuel: "Coal" } }),
  ).toBe("coal");
  expect(
    structureKind({ ...tile, facility: { ...tile.facility, fuel: "Oil" } }),
  ).toBe("oil");
  expect(
    structureKind({
      ...tile,
      facility: { ...tile.facility, fuel: "Natural Gas" },
    }),
  ).toBe("gas");
});
test("conductors use elevated real terminals and retain mesh identity across unrelated ticks", () => {
  const views = [view(), view(1)],
    tiles = views.map((item) => item.tile);
  const wires = hexWires(tiles, () => true);
  const { builder } = setup();
  const first = builder.build(views, tiles, wires, 0, "run");
  const wire = first.find((item) => item.id === "wires:0")!;
  const positions = wire.model.parts[0].mesh.positions;
  const heights = Array.from(positions).filter((_, index) => index % 3 === 1);
  expect(Math.min(...heights)).toBeGreaterThan(0.18);
  expect(Math.max(...heights)).toBeGreaterThan(0.29);
  expect(
    Math.min(...Array.from(positions).filter((_, index) => index % 3 === 0)),
  ).toBeGreaterThan(0.09);
  const second = builder.build(
    views.map((item) => ({ ...item })),
    tiles,
    wires,
    100,
    "run",
  );
  expect(second.find((item) => item.id === "wires:0")!.model).toBe(wire.model);
});
