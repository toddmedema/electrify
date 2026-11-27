import { STORAGE } from "../../../data/Facilities";
import { createGame } from "../../../testing/Simulator";
import { territoryTileViews } from "../../../helpers/TerritoryMapState";
import { isStorage } from "../../../Types";
import type { StorageOperatingType } from "../../../Types";
import * as facilityStatus from "../FacilityMapStatus";
import type { TerritoryTileView } from "../../../helpers/TerritoryMapState";
import { HEX_NEIGHBORS, hexWires } from "../TerritoryHexGeometry";
import { MeshBuilder } from "./MeshBuilder";
import { SceneBuilder, structureKind } from "./SceneBuilder";
import type { MapModel } from "./Types";
import { GROUND_HEX_CORNERS } from "./Projection";
import { surfaceHeight } from "./SurfaceHeight";
import { getTerrainModel } from "./TerrainModels";
import { getStructureModel } from "./StructureModels";
import { buildSelectionBorder } from "./BorderGeometry";
import { buildWildfireEmitters, isBurningTerrain } from "./WildfireFront";

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
    structure = jest.fn<MapModel, Parameters<typeof getStructureModel>>(
      (_kind, _growth, _size, stage) =>
        stage === undefined
          ? model
          : {
              ...model,
              key: `${model.key}:construction:${stage}`,
              terminals: stage === 3 ? model.terminals : [],
            },
    );
  return {
    builder: new SceneBuilder({ terrain, structure }),
    terrain,
    structure,
  };
}

test("a wildfire follows raised terrain and joins only adjacent active fuel", () => {
  const burning = { ground: "burning", condition: "Wildfire burning" } as const;
  const slope: TerritoryTileView = {
    ...view(),
    tile: { ...view().tile, terrain: "mountain" },
    disaster: burning,
  };
  const forest: TerritoryTileView = {
    ...view(1),
    tile: { ...view(1).tile, terrain: "forest" },
    disaster: { ground: "scorched", condition: "Scorched by wildfire" },
  };
  const firebreak: TerritoryTileView = {
    ...view(2),
    tile: { ...view(2).tile, id: "green-uplands:site-3" },
    disaster: burning,
  };
  const views = [slope, forest, firebreak];
  const board = views.map(({ tile }) => tile);
  const builder = new SceneBuilder({
    terrain: getTerrainModel,
    structure: getStructureModel,
  });
  const initial = builder
    .build(views, board, [], 0, "run")
    .filter(isBurningTerrain);
  expect(initial.map(({ id }) => id)).toEqual([`terrain:${slope.tile.id}`]);
  const slopeOnly = buildWildfireEmitters(initial);
  expect(slopeOnly.some(({ origin }) => origin[1] > 0.25)).toBe(true);
  expect(slopeOnly.every(({ origin }) => Math.abs(origin[0]) < 0.5)).toBe(true);

  const neighboringFire = {
    ...forest,
    disaster: burning,
  };
  const active = builder
    .build([slope, neighboringFire, firebreak], board, [], 0, "run")
    .filter(isBurningTerrain);
  expect(active.map(({ id }) => id)).toEqual([
    `terrain:${slope.tile.id}`,
    `terrain:${forest.tile.id}`,
  ]);
  const joined = buildWildfireEmitters(active);
  const forestOnly = buildWildfireEmitters(active.slice(1));
  expect(joined).toEqual(expect.arrayContaining([...slopeOnly, ...forestOnly]));
  expect(joined.filter(({ origin }) => origin[0] === 0.5)).toHaveLength(1);
  expect(joined.every(({ origin }) => origin[0] < 1.5)).toBe(true);
  expect(buildWildfireEmitters([...active].reverse())).toEqual(joined);
});
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
  expect(structure).toHaveBeenCalledWith("tower", undefined, undefined);
  expect(result.map((item) => item.id)).toEqual([
    "terrain:green-uplands:site-1",
    "structure:green-uplands:site-1",
    "terrain:green-uplands:site-2",
  ]);
});
test("scatters the four farm layouts across open plains consistently on scene rebuilds", () => {
  const views = Array.from({ length: 40 }, (_, i) => ({
    ...view(),
    developed: false,
    tile: {
      ...view().tile,
      id: `frontier:${i % 8}:${Math.floor(i / 8)}` as const,
      q: i % 8,
      r: Math.floor(i / 8),
    },
  }));
  const layouts = (order: typeof views) => {
    const builder = new SceneBuilder({
      terrain: getTerrainModel,
      structure: getStructureModel,
    });
    return builder
      .build(
        order,
        order.map((v) => v.tile),
        [],
        0,
        "run",
      )
      .map(({ model }) => model);
  };
  const original = layouts(views);
  expect(new Set(original).size).toBe(4);
  for (const [i, { tile }] of views.entries()) {
    const neighbors = HEX_NEIGHBORS.map(([dq, dr]) =>
      views.findIndex(
        ({ tile: neighbor }) =>
          neighbor.q === tile.q + dq && neighbor.r === tile.r + dr,
      ),
    ).filter((index) => index >= 0);
    expect(neighbors.map((index) => original[index])).not.toContain(
      original[i],
    );
  }
  expect(layouts([...views].reverse()).reverse()).toEqual(original);
  expect(layouts(views.slice(1))).toEqual(original.slice(1));
  for (const [i, site] of views.entries())
    expect(layouts([site])[0]).toBe(original[i]);
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
    variant: expect.any(Number),
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
      midY: 0.195,
      lowY: 0.195,
    },
  ]);
});

test.each([
  ["small", 50e6],
  ["medium", 150e6],
] as const)(
  "lands the submerged wire on %s offshore switchgear",
  (size, peakW) => {
    const ocean: TerritoryTileView = {
      ...view(),
      tile: {
        ...view().tile,
        q: 2,
        r: 1,
        terrain: "ocean",
        city: undefined,
        siteKind: "wind",
        maxPeakW: Infinity,
      },
      facility: {
        name: "Offshore Wind",
        fuel: "Offshore Wind",
        peakW,
        yearsToBuildLeft: 0,
      },
    };
    const shore = { ...view(1), tile: { ...view(1).tile, q: 3, r: 1 } };
    const tiles = [ocean.tile, shore.tile];
    const scene = new SceneBuilder({
      terrain: getTerrainModel,
      structure: getStructureModel,
    }).build(
      [ocean, shore],
      tiles,
      hexWires(
        tiles,
        () => true,
        () => true,
        (tile) => tile.terrain === "ocean",
      ),
      0,
      "run",
    );
    const turbine = scene.find(
      ({ id }) => id === `structure:${ocean.tile.id}`,
    )!;
    expect(turbine.model).toBe(getStructureModel("offshore-wind", [], size));
    const terminal = turbine.model.terminals[1];
    const wire = scene.find(({ id }) => id === "wires:0")!;
    const [connection] = wire.model.connections!;
    expect(connection.from).toBe(ocean.tile.id);
    expect(connection.kind).toBe("submerged");
    expect(connection.start).toEqual(
      terminal.map((axis, i) => axis + turbine.position[i]),
    );
  },
);

test("gives ocean tiles their nearby land and coastal land a sea-facing trim", () => {
  const ocean: TerritoryTileView = {
    ...view(),
    tile: {
      ...view().tile,
      q: 2,
      r: 1,
      terrain: "ocean",
      city: undefined,
      siteKind: "wind",
      maxPeakW: Infinity,
    },
  };
  const shore = { ...view(1), tile: { ...view(1).tile, q: 3, r: 1 } };
  const tiles = [ocean.tile, shore.tile];
  const scene = new SceneBuilder({
    terrain: getTerrainModel,
    structure: getStructureModel,
  }).build([ocean, shore], tiles, [], 0, "run");
  const byId = new Map(scene.map((instance) => [instance.id, instance]));
  // The land tile is the ocean's second neighbour; the ocean is the land's fifth.
  expect(byId.get(`terrain:${ocean.tile.id}`)!.shore).toBe(1 << 1);
  expect(byId.get(`terrain:${shore.tile.id}`)!.shore).toBeUndefined();
  expect(byId.has(`coast:${ocean.tile.id}`)).toBe(false);
  const coast = byId.get(`coast:${shore.tile.id}`)!;
  expect(coast.model.key).toMatch(/^coast:(beach|cliff):16(:|$)/);
  expect(coast.position).toBe(byId.get(`terrain:${shore.tile.id}`)!.position);
});

test.each([undefined, "impact"] as const)(
  "keeps wires out of the solar panel racks from all six neighboring pylons (%s)",
  (hail) => {
    const solar: TerritoryTileView = {
      ...view(),
      facility: { name: "Solar", fuel: "Sun", peakW: 1, yearsToBuildLeft: 0 },
      ...(hail && { disaster: { condition: "Hail", hail } }),
    };
    for (const [q, r] of HEX_NEIGHBORS) {
      const neighbor = { ...view(1), tile: { ...view(1).tile, q, r } };
      const views = [solar, neighbor];
      const tiles = views.map(({ tile }) => tile);
      const scene = new SceneBuilder({
        terrain: getTerrainModel,
        structure: getStructureModel,
      }).build(
        views,
        tiles,
        hexWires(tiles, () => true),
        0,
        "run",
      );
      const wire = scene.find(({ id }) => id === "wires:0")!;
      const [connection] = wire.model.connections!;
      const terminal =
        connection.from === solar.tile.id ? connection.start : connection.end;
      expect(terminal[1]).toBeLessThan(0.06);
      const mesh = wire.model.parts[0].mesh.positions;
      const aboveRacks = Array.from(mesh).some(
        (x, i) =>
          i % 3 === 0 &&
          Math.abs(x + wire.position[0]) < 0.31 &&
          Math.abs(mesh[i + 2] + wire.position[2]) < 0.26 &&
          mesh[i + 1] + wire.position[1] > 0.07,
      );
      expect(aboveRacks).toBe(false);
    }
  },
);

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
  expect((wire.start[1] + wire.end[1]) / 2 - wire.midY).toBeGreaterThan(0.001);
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
    ({ terrain }) => terrain === "lake",
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

test("construction changes only at milestones, including after a jump or resume", () => {
  const tile = {
    ...view(),
    tile: { ...view().tile, terrain: "river" as const },
    facility: {
      name: "Solar",
      fuel: "Sun",
      peakW: 1,
      yearsToBuildLeft: 1,
      yearsToBuild: 1,
    },
  } satisfies TerritoryTileView;
  const { builder, terrain, structure } = setup(),
    tiles = [tile.tile];
  const build = (yearsToBuildLeft: number) =>
    builder.build(
      [{ ...tile, facility: { ...tile.facility, yearsToBuildLeft } }],
      tiles,
      [],
      100,
      "run",
    );
  const first = build(1);
  expect(first[1].model.key).toBe("test-structure:construction:0");
  expect(build(0.751)).toBe(first);
  expect(build(0.75)[1].model.key).toBe("test-structure:construction:1");
  expect(build(0.5)[1].model.key).toBe("test-structure:construction:2");
  expect(build(0.25)[1].model.key).toBe("test-structure:construction:3");
  expect(build(0.001)[1].model.key).toBe("test-structure:construction:3");
  const commissioned = build(0);
  expect(commissioned[0]).toBe(first[0]);
  expect(commissioned[1].model).toBe(model);
  expect(terrain).toHaveBeenCalledTimes(1);
  expect(structure).toHaveBeenCalledTimes(5);
  expect(build(0.7)[1].model.key).toBe("test-structure:construction:1");
});

test("keeps the existing grid connected while a new plant fits its own switchgear", () => {
  const target = view();
  const peer: TerritoryTileView = {
    ...target,
    ownerKey: "peer:1",
    owned: false,
    facility: {
      name: "Solar",
      fuel: "Sun",
      peakW: 50e6,
      yearsToBuild: 1,
      yearsToBuildLeft: 0.5,
    },
  };
  const neighbor = view(1);
  const lake: TerritoryTileView = {
    ...view(-1),
    tile: { ...view(-1).tile, id: "green-uplands:site-3", terrain: "lake" },
  };
  const tiles = [target.tile, neighbor.tile, lake.tile];
  const wires = hexWires(
    tiles,
    () => true,
    undefined,
    ({ terrain }) => terrain === "lake",
  );
  const builder = new SceneBuilder({
    terrain: getTerrainModel,
    structure: getStructureModel,
  });
  const build = (
    yearsToBuildLeft: number,
    yearsToBuild?: number,
    links = wires,
  ) => {
    const scene = builder.build(
      [
        {
          ...peer,
          facility: { ...peer.facility!, yearsToBuildLeft, yearsToBuild },
        },
        neighbor,
        lake,
      ],
      tiles,
      links,
      0,
      "run",
    );
    return {
      plant: scene.find(({ id }) => id === `structure:${target.tile.id}`)!,
      junction: scene.find(
        ({ id }) => id === `grid-junction:${target.tile.id}`,
      ),
      wire: scene.find(({ id }) => id === "wires:0")!,
    };
  };
  const legacy = build(0.1);
  expect(legacy.plant.model).toBe(getStructureModel("solar", [], "small", 0));
  const installing = build(0.5, 1);
  expect(installing.plant.model).toBe(
    getStructureModel("solar", [], "small", 2),
  );
  expect(installing.junction).toBe(legacy.junction);
  expect(installing.wire).toBe(legacy.wire);
  const existingLink = installing.wire.model.connections!.find(
    ({ kind }) => kind === "overhead",
  )!;
  const { model: junction, position } = installing.junction!;
  expect(
    junction.terminals.map(([x, y, z]) => [
      x + position[0],
      y + position[1],
      z + position[2],
    ]),
  ).toContainEqual(existingLink.start);
  expect(installing.wire.model.connections!).toContainEqual(
    expect.objectContaining({
      kind: "submerged",
      from: target.tile.id,
      to: lake.tile.id,
      start: [0, 0.006, 0],
    }),
  );

  const commissioning = build(0.24, 1);
  expect(commissioning.junction).toBeUndefined();
  expect(commissioning.wire.model.connections).toHaveLength(2);
  for (const installedLink of commissioning.wire.model.connections!) {
    expect(installedLink.from).toBe(target.tile.id);
    expect(commissioning.plant.model.terminals).toContainEqual(
      installedLink.start,
    );
  }
  expect(commissioning.plant).toMatchObject({
    active: false,
    producing: false,
  });
  expect(build(0, 1).wire).toBe(commissioning.wire);

  const buried = build(
    0.5,
    1,
    wires.filter(({ kind }) => kind === "submerged"),
  );
  expect(buried.junction).toBeUndefined();
  expect(buried.wire.model.connections![0]).toMatchObject({
    kind: "submerged",
    start: [0, 0.006, 0],
  });
});

test("the selection mesh places two backed dashes on all six hex edges", () => {
  const { model } = buildSelectionBorder(view().tile);
  for (const [edge, [x, z]] of GROUND_HEX_CORNERS.entries()) {
    const [nextX, nextZ] = GROUND_HEX_CORNERS[(edge + 1) % 6];
    for (const along of [0.25, 0.75]) {
      const dx = x + (nextX - x) * along;
      const dz = z + (nextZ - z) * along;
      // Sample slightly outward from the dash center to hit its wider backing.
      const backing = surfaceHeight(model, dx * 1.034, dz * 1.034);
      expect(backing).toBeGreaterThan(0);
      expect(surfaceHeight(model, dx, dz)).toBeGreaterThan(backing);
    }
    expect(surfaceHeight(model, (x + nextX) / 2, (z + nextZ) / 2)).toBe(0);
  }
});

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
      peakW: 250e6,
      yearsToBuildLeft: 0,
    },
    operatingFacility: {
      ...facility,
      name: "Natural Gas Steam",
      fuel: "Natural Gas",
      gasCycle: "steam",
      peakW: 250e6,
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

it("rebuilds the same site at the exact rated power thresholds", () => {
  const builder = new SceneBuilder({
    terrain: getTerrainModel,
    structure: getStructureModel,
  });
  const site = view();
  const tiles = [site.tile];
  const build = (peakW: number) =>
    builder.build(
      [
        {
          ...site,
          facility: { name: "Solar", fuel: "Sun", peakW, yearsToBuildLeft: 0 },
        },
      ],
      tiles,
      [],
      0,
      "run",
    )[1];
  const small = build(100e6 - 1);
  expect(small.model).toBe(getStructureModel("solar", [], "small"));

  const medium = build(100e6);
  expect(medium.id).toBe(small.id);
  expect(medium.model).toBe(getStructureModel("solar", [], "medium"));
  expect(build(500e6 - 1).model).toBe(medium.model);
  expect(build(500e6).model).toBe(getStructureModel("solar", [], "large"));
});

it("uses storage power instead of energy capacity for the construction model", () => {
  const builder = new SceneBuilder({
    terrain: getTerrainModel,
    structure: getStructureModel,
  });
  const site = view();
  const [, building] = builder.build(
    [
      {
        ...site,
        facility: {
          name: "Battery",
          peakW: 99e6,
          peakWh: 600e6,
          yearsToBuildLeft: 1,
        },
      },
    ],
    [site.tile],
    [],
    0,
    "run",
  );
  expect(building.model.key).toBe("structure:battery:small:construction:0");
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

test("frost follows the land surface as cold starts and ends, independently of structures", () => {
  const dry = view();
  const cold: TerritoryTileView = {
    ...dry,
    disaster: { frost: "derate", condition: "Extreme cold" },
  };
  const { builder } = setup();
  const tiles = [dry.tile];
  const [ground, tower] = builder.build([dry], tiles, [], 0, "run");
  const [frosted, sameTower] = builder.build([cold], tiles, [], 15, "run");
  expect(frosted.frost).toBe(true);
  expect(frosted.model).toBe(ground.model);
  expect(sameTower).toEqual(tower);
  expect(sameTower).not.toMatchObject({ frost: true });
  const [thawed] = builder.build([dry], tiles, [], 30, "run");
  expect(thawed).not.toMatchObject({ frost: true });
  expect(thawed.model).toBe(ground.model);
});

test("hail hits the ground and panels, then leaves only fractured panels during repairs", () => {
  const tile: TerritoryTileView = {
    ...view(),
    facility: { name: "Solar", fuel: "Sun", peakW: 6e6, yearsToBuildLeft: 0 },
  };
  const board = [tile.tile];
  const builder = new SceneBuilder({
    terrain: getTerrainModel,
    structure: getStructureModel,
  });
  const [ground, intact] = builder.build([tile], board, [], 0, "run");
  const [, stones, damaged] = builder.build(
    [{ ...tile, disaster: { hail: "impact", condition: "Hail strike" } }],
    board,
    [],
    15,
    "run",
  );
  expect(ground.model).toBe(
    builder.build([tile], board, [], 30, "run")[0].model,
  );
  expect(stones.model.key).toBe("weather:hail");
  expect(stones.model.parts).toHaveLength(12);
  const surfaces = stones.model.parts.map(({ mesh, position }) => {
    const [x, y, z] = position!;
    const groundY = surfaceHeight(ground.model, x, z);
    const panelY = damaged.position[1] + surfaceHeight(damaged.model, x, z);
    const stoneRadius = Math.max(
      ...mesh.positions.filter((_value, index) => index % 3 === 1),
    );
    expect(y - stoneRadius).toBeCloseTo(Math.max(groundY, panelY), 6);
    return panelY > groundY ? "panel" : "ground";
  });
  expect(surfaces).toEqual(expect.arrayContaining(["ground", "panel"]));
  expect(damaged.model.key).toBe("structure:solar-hail-damaged:small");
  const unbuilt = builder.build(
    [
      {
        ...tile,
        facility: { ...tile.facility!, yearsToBuildLeft: 1, yearsToBuild: 1 },
        disaster: { hail: "impact", condition: "Hail strike" },
      },
    ],
    board,
    [],
    20,
    "run",
  );
  expect(unbuilt).toHaveLength(2);
  expect(unbuilt[1].model.parts).toEqual(
    getStructureModel("solar", [], "small", 0).parts,
  );
  expect(damaged.model.terminals).toEqual(intact.model.terminals);
  expect(damaged.model.parts[0].mesh.positions).not.toEqual(
    intact.model.parts[0].mesh.positions,
  );

  const repairing = builder.build(
    [
      {
        ...tile,
        disaster: { hail: "damage", condition: "Hail repairs in progress" },
      },
    ],
    board,
    [],
    90,
    "run",
  );
  expect(repairing).toHaveLength(2);
  expect(repairing[1].model).toBe(damaged.model);
  expect(builder.build([tile], board, [], 720, "run")[1].model).toBe(
    intact.model,
  );
});

test("raises a tower from the foundation, then connects wires to its finished terminals", () => {
  const neighbor = view(1);
  const site = view();
  const pending: TerritoryTileView = {
    ...site,
    developed: false,
    connection: { startedMinute: 0, towerMinute: 120, connectionMinute: 120 },
  };
  const tiles = [site.tile, neighbor.tile];
  const builder = new SceneBuilder({
    terrain: getTerrainModel,
    structure: getStructureModel,
  });
  const snapshot = (minute: number) => {
    const views = [minute >= 120 ? site : pending, neighbor];
    const wires = hexWires(
      tiles,
      ({ id }) => !!views.find(({ tile }) => tile.id === id)?.developed,
    );
    const scene = builder.build(views, tiles, wires, minute, "run");
    const tower = scene.find(({ id }) => id === `structure:${site.tile.id}`)!;
    return {
      height: tower.model.height,
      terminal: tower.model.terminals[0],
      wires: scene.flatMap(({ model }) => model.connections ?? []),
    };
  };
  const foundation = snapshot(0);
  const framing = snapshot(60);
  const ready = snapshot(120);
  expect(foundation.height).toBeLessThan(framing.height);
  expect(framing.height).toBeLessThan(ready.height);
  expect(foundation.wires).toHaveLength(0);
  expect(framing.wires).toHaveLength(0);
  expect(ready.wires).toHaveLength(1);
  expect(ready.wires[0].start[1]).toBeCloseTo(ready.terminal[1]);
});
