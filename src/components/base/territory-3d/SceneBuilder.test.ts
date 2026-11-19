import { STORAGE } from "../../../data/Facilities";
import { createGame } from "../../../testing/Simulator";
import { territoryTileViews } from "../../../helpers/TerritoryMapState";
import { isStorage } from "../../../Types";
import type { StorageOperatingType } from "../../../Types";
import * as facilityStatus from "../FacilityMapStatus";
import type { TerritoryTileView } from "../../../helpers/TerritoryMapState";
import { hexWires } from "../TerritoryHexGeometry";
import { MeshBuilder } from "./MeshBuilder";
import { SceneBuilder, structureKind } from "./SceneBuilder";
import type { MapModel, Vec3 } from "./Types";
import { projectPoint, tilePosition3D } from "./Projection";
import { getTerrainModel } from "./TerrainModels";
import { getStructureModel } from "./StructureModels";
import { buildOwnershipBorder, buildSelectionBorder } from "./BorderGeometry";
import { TERRITORY_OWNER_PALETTE } from "../TerritoryMapLayout";

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
  expect(result[1].producing).toBe(false);
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

test("mountain pylons stand on the raised summit pad and lift nearby wire terminals", () => {
  const peak = {
    ...view(),
    tile: { ...view().tile, terrain: "mountain" as const },
  };
  const foothill = view(1);
  const views = [peak, foothill];
  const tiles = views.map(({ tile }) => tile);
  const builder = new SceneBuilder({
    terrain: getTerrainModel,
    structure: getStructureModel,
  });
  const frames = builder.build(
    views,
    tiles,
    hexWires(tiles, () => true),
    0,
    "run",
  );
  const mountain = frames.find(
    (frame) => frame.id === `terrain:${peak.tile.id}`,
  )!;
  const tower = frames.find(
    (frame) => frame.id === `structure:${peak.tile.id}`,
  )!;
  const [wire] = frames.find((frame) => frame.id === "wires:0")!.model
    .connections!;
  expect(tower.position[1]).toBeGreaterThan(0.6);
  expect(tower.position[1]).toBe(mountain.model.supportY);
  expect(tower.position[1]).toBeCloseTo(mountain.model.height);
  expect(wire.start[1] - wire.end[1]).toBeCloseTo(tower.position[1]);
  expect(wire.lowY).toBeGreaterThan(0.2);
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

test("submerged cable geometry reaches the land terminal", () => {
  const land = view(1);
  const water = {
    ...view(),
    tile: { ...view().tile, terrain: "lake" as const },
  };
  const views = [water, land];
  const tiles = views.map(({ tile }) => tile);
  const { builder } = setup();
  const wires = hexWires(
    tiles,
    () => true,
    undefined,
    ({ terrain }) => (terrain === "lake" ? "submerged" : "tower"),
  );
  const cable = builder
    .build(views, tiles, wires, 0, "run")
    .find(({ id }) => id === "wires:0")!;
  const [connection] = cable.model.connections!;
  expect(connection.kind).toBe("submerged");
  expect(connection.to).toBe(land.tile.id);
  const vertices = cable.model.parts[0].mesh.positions;
  let nearest = Infinity;
  for (let i = 0; i < vertices.length; i += 3)
    nearest = Math.min(
      nearest,
      Math.hypot(
        vertices[i] + cable.position[0] - connection.end[0],
        vertices[i + 1] + cable.position[1] - connection.end[1],
        vertices[i + 2] + cable.position[2] - connection.end[2],
      ),
    );
  expect(nearest).toBeLessThan(0.01);
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
test("real mountain relief picks its own tile above the neighboring ground hex", () => {
  const mountain = {
    ...view(),
    developed: false,
    tile: { ...view().tile, terrain: "mountain" as const },
  };
  const north = {
    ...view(1),
    developed: false,
    tile: { ...view(1).tile, q: 0.5, r: -1 },
  };
  const builder = new SceneBuilder({
    terrain: getTerrainModel,
    structure: getStructureModel,
  });
  const relief = getTerrainModel("mountain").parts[1].mesh.positions;
  let face = 0;
  for (let i = 9; i < relief.length; i += 9) {
    const highest = (start: number) =>
      Math.max(relief[start + 1], relief[start + 4], relief[start + 7]);
    if (highest(i) > highest(face)) face = i;
  }
  const centroid = (axis: number) =>
    (relief[face + axis] + relief[face + axis + 3] + relief[face + axis + 6]) /
    3;
  const peak = projectPoint([centroid(0), centroid(1), centroid(2)], pickFrame);
  for (const views of [
    [mountain, north],
    [north, mountain],
  ]) {
    builder.build(
      views,
      views.map((item) => item.tile),
      [],
      0,
      "run",
    );
    expect(builder.pick(peak, pickFrame)).toBe(mountain.tile.id);
  }
});
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
  expect(builder.pick(projectPoint([-0.3, 0, 0], pickFrame), pickFrame)).toBe(
    tile.tile.id,
  );
  expect(
    builder.pick(projectPoint([-0.6, 0, 0], pickFrame), pickFrame),
  ).toBeUndefined();
});
test("picks distinct retained hexes that share a facility tile ID", () => {
  const retained = [view(), view(2)].map((item) => ({
    ...item,
    developed: false,
    tile: { ...item.tile, id: "green-uplands:legacy-100" as const },
  }));
  const builder = new SceneBuilder({
    terrain: () => flatGround,
    structure: () => model,
  });
  const tiles = retained.map(({ tile }) => tile);
  builder.build(retained, tiles, [], 0, "run");
  expect(
    tiles.map((tile) =>
      builder.pick(projectPoint(tilePosition3D(tile), pickFrame), pickFrame),
    ),
  ).toEqual(["retained:0:0", "retained:2:0"]);
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
test("ownership edges and selection dashes cannot intercept ground picking", () => {
  const land = { ...view(), developed: false };
  const neighbor = { ...view(1), developed: false };
  const builder = new SceneBuilder({
    terrain: getTerrainModel,
    structure: getStructureModel,
  });
  const tiles = [land.tile, neighbor.tile];
  const scene = builder.build([land, neighbor], tiles, [], 0, "run");
  const ownership = buildOwnershipBorder(
    [land, neighbor],
    TERRITORY_OWNER_PALETTE.light,
    {},
    false,
  )!;
  const selection = buildSelectionBorder(land.tile);
  // The joined area has ten exposed edges with two quads for each painted stroke.
  expect(ownership.model.parts[0].mesh.positions.length / 9).toBe(40);
  // This point is inside a selection dash and also over the terrain below it.
  const point = projectPoint([0.494, 0.012, -0.17], pickFrame);
  expect(
    builder.pick(point, pickFrame, undefined, [...scene, ownership, selection]),
  ).toBe(land.tile.id);
});
test.each(["wind", "offshore-wind"] as const)(
  "picks the actual %s blade at signed retained phases and misses its mirrored pose",
  (kind) => {
    const wind = getStructureModel(kind),
      rotor = wind.parts.find((part) => part.motion === "rotor")!,
      builder = new SceneBuilder({
        terrain: () => flatGround,
        structure: () => wind,
      }),
      tile = view();
    builder.build([tile], [tile.tile], [], 0, "run");
    // Pick inside the uppermost front-facing real blade triangle, above the tower.
    let blade: Vec3 = [0, 0, 0];
    for (let i = 0; i < rotor.mesh.positions.length; i += 9) {
      if (rotor.mesh.normals[i + 2] < 0.4) continue;
      const coordinate = (axis: number) =>
        (rotor.mesh.positions[i + axis] +
          rotor.mesh.positions[i + 3 + axis] +
          rotor.mesh.positions[i + 6 + axis]) /
        3;
      const center: Vec3 = [coordinate(0), coordinate(1), coordinate(2)];
      if (center[1] > blade[1]) blade = center;
    }
    expect(blade[1]).toBeGreaterThan(0.15);
    for (const phase of [0.2, -0.2]) {
      // Independent clockwise expectation, deliberately not the production angle helper.
      const point = projectPoint(
          [
            blade[0] * Math.cos(phase) +
              blade[1] * Math.sin(phase) +
              rotor.position![0],
            -blade[0] * Math.sin(phase) +
              blade[1] * Math.cos(phase) +
              rotor.position![1],
            blade[2] + rotor.position![2],
          ],
          pickFrame,
        ),
        motionPhase = (key: string) =>
          key === `structure:${tile.tile.id}` ? phase : 0;
      expect(builder.pick(point, pickFrame, motionPhase)).toBe(tile.tile.id);
      expect(
        builder.pick(
          { ...point, x: pickFrame.width - point.x },
          pickFrame,
          motionPhase,
        ),
      ).toBeUndefined();
    }
  },
);

function operatingView() {
  const game = createGame({ scenarioId: 116, seed: 188 });
  const view = territoryTileViews(game).find((tile) => tile.operatingFacility)!;
  const facility = view.operatingFacility!;
  facility.yearsToBuildLeft = 0;
  facility.currentW = 20e6;
  facility.paused = false;
  return { game, view, facility };
}

it("selects the distinct boiler and switches its production effects off as the plant idles", () => {
  const { view, facility } = operatingView();
  if (isStorage(facility)) throw new Error("Expected a generator fixture");
  const steam: TerritoryTileView = {
    ...view,
    facility: {
      name: "Natural Gas Steam",
      fuel: "Natural Gas",
      peakW: facility.peakW,
      yearsToBuildLeft: 0,
    },
    operatingFacility: {
      ...facility,
      name: "Natural Gas Steam",
      fuel: "Natural Gas",
      gasCycle: "steam",
      peakWh: undefined,
    },
  };
  const builder = new SceneBuilder({
    terrain: getTerrainModel,
    structure: getStructureModel,
  });
  const tiles = [steam.tile];
  const active = builder.build([steam], tiles, [], 0, "run")[1];
  expect(active).toMatchObject({
    model: { key: "structure:gas-steam" },
    active: true,
    producing: true,
  });
  const idle: TerritoryTileView = {
    ...steam,
    operatingFacility: { ...steam.operatingFacility!, currentW: 0 },
  };
  const stopped = builder.build([idle], tiles, [], 60, "run")[1];
  expect(stopped).toMatchObject({ active: false, producing: false });
  expect(stopped.model).toBe(active.model);
});

it("follows measured production through idle, pause and construction without changing motion identity", () => {
  const { builder } = setup();
  const { view, facility } = operatingView();
  const tiles = [view.tile];
  const build = () => builder.build([view], tiles, [], 0, "run");
  const running = build();
  expect(running[1]).toMatchObject({ active: true, producing: true });
  expect(running[0].active).toBe(false);
  const motionKey = running[1].motionKey;
  facility.currentW = 0;
  const idle = build()[1];
  expect(idle).toMatchObject({ active: false, producing: false, motionKey });
  facility.currentW = 20e6;
  facility.paused = true;
  expect(build()[1]).toMatchObject({
    active: false,
    producing: false,
    motionKey,
  });
  facility.paused = false;
  facility.yearsToBuildLeft = 0.25;
  const building = build()[1];
  expect(building).toMatchObject({
    active: false,
    producing: false,
    motionKey,
  });
  expect(building.model.key).toContain(":construction");
});

it("keeps the operating base lit when a separate map badge reports construction", () => {
  const { builder } = setup();
  const { view } = operatingView();
  const badge = jest
    .spyOn(facilityStatus, "facilityMapStatus")
    .mockReturnValue({
      kind: "construction",
      label: "Adding capacity",
    });
  try {
    const result = builder.build([view], [view.tile], [], 0, "run");
    expect(result[1]).toMatchObject({ active: true, producing: true });
    expect(result[1].model).toBe(model);
  } finally {
    badge.mockRestore();
  }
});

it.each(["Battery", "Pumped Hydro"] as const)(
  "animates charging %s without claiming production",
  (technology) => {
    const { builder } = setup();
    const { game, view } = operatingView();
    game.date.year = 2025;
    const quote = STORAGE(
      { ...game, location: { ...game.location, id: "Boston" } },
      100e6,
    ).find((quote) => quote.name === technology)!;
    expect(quote).toBeDefined();
    const facility: StorageOperatingType = {
      ...quote,
      id: 500,
      currentW: -20e6,
      currentWh: 50e6,
      yearsToBuildLeft: 0,
      minuteCreated: 0,
      loanAmountTotal: 0,
      loanAmountLeft: 0,
      loanMonthlyPayment: 0,
      interestRate: 0,
      lifetimeWh: 0,
      lifetimePotentialWh: 0,
      lifetimeRevenue: 0,
      lifetimeExpenses: 0,
    };
    const tile: TerritoryTileView = {
      ...view,
      facility,
      operatingFacility: facility,
    };
    const tiles = [view.tile];
    const charging = builder.build([tile], tiles, [], 0, "run");
    expect(charging[1]).toMatchObject({ active: true, producing: false });
    expect(charging[1].waterLevel).toBe(
      technology === "Pumped Hydro" ? 50e6 / facility.peakWh : undefined,
    );
    facility.currentW = 20e6;
    facility.currentWh = 20e6;
    const discharging = builder.build([tile], tiles, [], 1, "run");
    expect(discharging[1]).toMatchObject({ active: true, producing: true });
    expect(discharging[1]).not.toBe(charging[1]);
    expect(discharging[1].motionKey).toBe(charging[1].motionKey);
    expect(discharging[1].waterLevel).toBe(
      technology === "Pumped Hydro" ? 20e6 / facility.peakWh : undefined,
    );
  },
);

it("follows the conventional hydro reservoir without rebuilding the terrain", () => {
  const { builder } = setup();
  const { view, facility } = operatingView();
  if (isStorage(facility)) throw new Error("Expected a starting generator");
  const hydro = {
    ...facility,
    fuel: "Hydro" as const,
    reservoirCapacityWh: 100,
    reservoirWh: 27,
  };
  const tile = { ...view, facility: hydro, operatingFacility: hydro };
  const tiles = [tile.tile];
  const build = () => builder.build([tile], tiles, [], 0, "run");
  const low = build();
  expect(low[1].waterLevel).toBe(0.27);
  hydro.reservoirWh = 80;
  const high = build();
  expect(high[1].waterLevel).toBe(0.8);
  expect(high[0]).toBe(low[0]);
  expect(high[1].model).toBe(low[1].model);
});

it("leaves city activity unknown even when an unrelated facility is present in its view", () => {
  const { builder } = setup();
  const { game, facility } = operatingView();
  const city = territoryTileViews(game).find((view) => view.tile.city)!;
  const tile = { ...city, facility, operatingFacility: facility };
  const result = builder.build([tile], [tile.tile], [], 0, "run");
  expect(result[1]).toMatchObject({ active: false, producing: false });
});
