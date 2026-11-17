import type { TerritoryTileView } from "../../../helpers/TerritoryMapState";
import { hexWires } from "../TerritoryHexGeometry";
import { MeshBuilder } from "./MeshBuilder";
import { SceneBuilder, structureKind } from "./SceneBuilder";
import type { MapModel } from "./Types";
import { projectPoint } from "./Projection";

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
    Math.min(...Array.from(positions).filter((_, index) => index % 3 === 0)) +
      wire.position[0],
  ).toBeGreaterThan(0.09);
  const second = builder.build(
    views.map((item) => ({ ...item })),
    tiles,
    wires,
    100,
    "run",
  );
  expect(second.find((item) => item.id === "wires:0")!.model).toBe(wire.model);
  expect(builder.build([], [], [], 200, "another-run")).toEqual([]);
  expect(wire.model.connections).toEqual([
    {
      from: views[0].tile.id,
      to: views[1].tile.id,
      kind: "overhead",
      start: [0.1, 0.3, 0],
      end: [0.9, 0.3, 0],
      lowY: 0.195,
    },
  ]);
});

test("frontier conductors carry their actual origin and bounds for viewport culling", () => {
  const views = [view(40), view(41)];
  views[1] = {
    ...views[1],
    tile: { ...views[1].tile, id: "green-uplands:site-3" },
  };
  const tiles = views.map((item) => item.tile),
    { builder } = setup();
  const wire = builder
    .build(
      views,
      tiles,
      hexWires(tiles, () => true),
      0,
      "run",
    )
    .find((item) => item.id === "wires:0")!;
  expect(wire.position[0]).toBeCloseTo(40.5);
  expect(wire.model.footprint).toBeGreaterThan(0.79);
  expect(wire.model.height).toBeGreaterThan(0.29);
  const positions = wire.model.parts[0].mesh.positions;
  const x = Array.from(positions).filter((_, index) => index % 3 === 0);
  expect(Math.min(...x)).toBeGreaterThan(-0.41);
  expect(Math.max(...x)).toBeLessThan(0.41);
});

test("power ticks reuse static terrain, structure and wire topology while construction stays live", () => {
  const tile = {
    ...view(),
    tile: { ...view().tile, terrain: "river" as const },
    facility: { name: "Solar", fuel: "Sun", peakW: 1, yearsToBuildLeft: 1 },
  } satisfies TerritoryTileView;
  const { builder, terrain, structure } = setup(),
    tiles = [tile.tile];
  const first = builder.build([tile], tiles, [], 0, "run");
  expect(first[1].model.key).toContain("construction");
  const second = builder.build([{ ...tile }], tiles, [], 100, "run");
  expect(second).toBe(first);
  const commissioned = builder.build(
    [{ ...tile, facility: { ...tile.facility, yearsToBuildLeft: 0 } }],
    tiles,
    [],
    200,
    "run",
  );
  expect(commissioned[0]).toBe(first[0]);
  expect(commissioned[1].model).toBe(model);
  expect(terrain).toHaveBeenCalledTimes(1);
  expect(structure).toHaveBeenCalledTimes(1);
});

const pickFrame = {
  width: 1280,
  height: 900,
  cameraX: 0,
  cameraY: 0,
  scale: 0.875,
};
const flatGround: MapModel = {
  ...model,
  key: "ground",
  parts: [
    {
      mesh: new MeshBuilder()
        .quad(
          [-0.5, 0, -0.5],
          [0.5, 0, -0.5],
          [0.5, 0, 0.5],
          [-0.5, 0, 0.5],
          [1, 1, 1],
        )
        .build(),
    },
  ],
};
test("picking follows solid elevated triangles and leaves gaps in a silhouette to the ground", () => {
  const triangle: MapModel = {
    ...model,
    key: "triangle",
    parts: [
      {
        mesh: new MeshBuilder()
          .triangle([0, 0.1, 0], [0.4, 0.1, 0], [0, 0.5, 0], [1, 1, 1])
          .build(),
      },
    ],
  };
  const builder = new SceneBuilder({
      terrain: () => flatGround,
      structure: () => triangle,
    }),
    tile = view();
  builder.build([tile], [tile.tile], [], 0, "run");
  expect(builder.pick(projectPoint([0.05, 0.4, 0], pickFrame), pickFrame)).toBe(
    tile.tile.id,
  );
  expect(
    builder.pick(projectPoint([0.35, 0.45, 0], pickFrame), pickFrame),
  ).toBeUndefined();
  expect(
    builder.pick(projectPoint([-0.3, 0, 0], pickFrame), pickFrame),
  ).toBeUndefined();
});
test("picking uses camera depth instead of tile iteration order", () => {
  const tall: MapModel = {
    ...model,
    key: "tall",
    parts: [
      {
        mesh: new MeshBuilder()
          .box([0, 0.45, 0], [0.3, 0.9, 0.3], [1, 1, 1])
          .build(),
      },
    ],
  };
  const front = view(),
    rear = { ...view(1), tile: { ...view(1).tile, q: 0.5, r: -1 } };
  const builder = new SceneBuilder({
    terrain: () => flatGround,
    structure: () => tall,
  });
  builder.build([front, rear], [front.tile, rear.tile], [], 0, "run");
  expect(builder.pick(projectPoint([0, 0.8, 0], pickFrame), pickFrame)).toBe(
    front.tile.id,
  );
});
test("picking follows the actual retained rotor phase without a React animation loop", () => {
  const rotor: MapModel = {
    ...model,
    key: "rotor",
    parts: [
      {
        position: [0, 0.5, 0],
        motion: "rotor",
        mesh: new MeshBuilder()
          .box([0, 0, 0], [0.6, 0.03, 0.03], [1, 1, 1])
          .build(),
      },
    ],
  };
  const builder = new SceneBuilder({
      terrain: () => flatGround,
      structure: () => rotor,
    }),
    tile = view();
  builder.build([tile], [tile.tile], [], 0, "run");
  const point = projectPoint([0.25, 0.5, 0], pickFrame);
  expect(builder.pick(point, pickFrame)).toBe(tile.tile.id);
  expect(
    builder.pick(point, pickFrame, {
      [`structure:${tile.tile.id}`]: Math.PI / 2,
    }),
  ).toBeUndefined();
});
