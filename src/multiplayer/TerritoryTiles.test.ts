import { getScenario } from "../data/Scenarios";
import { STORAGE } from "../data/Facilities";
import { LOCATIONS, TICK_MINUTES } from "../Constants";
import { getScenarioLocation } from "../helpers/Locations";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../helpers/DateTime";
import { projectReview, projectSiteQuote } from "../helpers/ProjectBuild";
import { currentTick } from "../helpers/GameSelectors";
import {
  assignTerritoryTiles,
  getTerritoryTiles,
} from "../helpers/TerritoryTiles";
import { loadSimData } from "../testing/SimData";
import { coopSeats } from "../testing/MultiplayerFixtures";
import { SAVE_SCHEMA_VERSION } from "../SaveSchema";
import {
  applyCommand,
  createWorld,
  checkpointWorld,
  restoreWorld,
  roomView,
  stepWorld,
} from "./World";
import type { StorageOperatingType } from "../Types";
import type { Command, World } from "./Types";
function ready(scenarioId = 116) {
  loadSimData(getScenarioLocation(getScenario(scenarioId))!);
  return createWorld(
    { scenarioId, difficulty: "Employee" },
    coopSeats(2),
    "tile-placement",
    "epoch",
  );
}
function retainedStorageWorld() {
  const world = ready();
  for (const grid of world.grids) {
    const quotes = STORAGE(
      { ...grid, location: LOCATIONS.SF, date: { ...grid.date, year: 2030 } },
      50e6,
    );
    expect(quotes.map(({ name }) => name)).toEqual([
      "Battery",
      "Iron-Air Battery",
      "Pumped Hydro",
    ]);
    for (const [index, quote] of quotes.entries()) {
      const { viableLocationsRemaining: _remaining, ...technology } = quote;
      const facility: StorageOperatingType = {
        ...technology,
        id: 100 + index,
        territoryId: "champlain",
        currentW: 0,
        currentWh: index === 1 ? 0 : quote.peakWh / 2,
        yearsToBuildLeft: index === 1 ? quote.yearsToBuild / 2 : 0,
        paused: index === 1,
        minuteCreated: 0,
        loanAmountTotal: quote.buildCost * 0.8,
        loanAmountLeft: quote.buildCost * 0.6,
        loanMonthlyPayment: 2000,
        interestRate: 0.05,
        lifetimeWh: 1e6,
        lifetimePotentialWh: 2e6,
        lifetimeRevenue: 10000,
        lifetimeExpenses: 2000,
      };
      grid.facilities.push(facility);
    }
    currentTick(grid)!.storedWh = 50e6;
    expect(assignTerritoryTiles(grid)).toBe(true);
  }
  return world;
}
function legacyCheckpoint(world: World) {
  const raw = JSON.parse(JSON.stringify(checkpointWorld(world)));
  raw.gameSchema = 15;
  for (const grid of raw.grids)
    if (grid.territoryNetwork) delete grid.territoryNetwork.legacyTiles;
  raw.rules =
    "coop-2-c12bab1ee04886f40ff0274d35e968e07cf7c3306f9e5ea006140bb973163fe4";
  for (const grid of raw.grids)
    for (const facility of grid.facilities) delete facility.tileId;
  return raw;
}
function build(world: World, tileId: unknown) {
  return applyCommand(world, "0", {
    matchId: world.matchId,
    epoch: world.epoch,
    sequence: (world.sequences["0"] ?? 0) + 1,
    command: {
      kind: "action",
      name: "buildFacility",
      payload: {
        facility: { name: "Wind", peakW: 50e6, buildCost: 0 },
        financed: true,
        territoryId: "champlain",
        tileId,
      },
    },
  });
}
it("host reserves the requested physical cell and rejects competing placements before charging", () => {
  const world = ready();
  const tile = getTerritoryTiles().find(
    (tile) =>
      tile.territoryId === "champlain" &&
      tile.siteKind === "wind" &&
      tile.terrain !== "ocean" &&
      !tile.startingAssetId,
  )!;
  expect(build(world, tile.id)).toBeUndefined();
  const cash = currentTick(world.grids[0])!.cash;
  const project = world.grids[0].facilities.find(
    (facility) => facility.tileId === tile.id,
  )!;
  expect(project.buildCost).toBeGreaterThan(0);
  expect(project.yearsToBuildLeft).toBeGreaterThan(0);
  expect(build(world, tile.id)).toMatch(/already/i);
  expect(currentTick(world.grids[0])!.cash).toBe(cash);
  expect(
    world.grids[0].facilities.filter((facility) => facility.tileId === tile.id),
  ).toHaveLength(1);
  const restored = restoreWorld(
    JSON.parse(JSON.stringify(checkpointWorld(world))),
    "restart",
  );
  expect(build(restored, tile.id)).toMatch(/already/i);
});
it("host commits both jobs and rejects a stale or repeated project order atomically", () => {
  const world = ready();
  const game = roomView(world, "0").game!;
  const request = { name: "Wind" as const, fuel: "Wind" as const, peakW: 20e6 };
  const quote = projectSiteQuote(game, request, "green-uplands:site-1");
  if (!quote.facility || !quote.connection) throw new Error(quote.reason);
  const review = projectReview(game, quote, true);
  const connectionQuoteKey = quote.connection.quoteKey;
  const submit = (reviewKey: string) =>
    applyCommand(world, "0", {
      matchId: world.matchId,
      epoch: world.epoch,
      sequence: (world.sequences["0"] ?? 0) + 1,
      command: {
        kind: "action",
        name: "buildFacility",
        payload: {
          facility: { name: request.name, peakW: request.peakW },
          financed: true,
          territoryId: quote.tile.territoryId,
          tileId: quote.tile.id,
          connectionQuoteKey,
          reviewKey,
        },
      },
    });
  const cash = currentTick(game)!.cash;
  expect(submit("expired")).toMatch(/terms changed/i);
  expect(world.grids[0].territoryNetwork?.tilePurchases).toHaveLength(0);
  expect(currentTick(world.grids[0])!.cash).toBe(cash);
  expect(submit(review.buildKey)).toBeUndefined();
  expect(world.grids[0].facilities).toContainEqual(
    expect.objectContaining({
      name: request.name,
      peakW: request.peakW,
      tileId: quote.tile.id,
      minuteCreated: game.date.minute,
    }),
  );
  expect(world.grids[0].territoryNetwork?.tilePurchases).toEqual([
    expect.objectContaining({
      tileId: quote.tile.id,
      minute: game.date.minute,
    }),
  ]);
  expect(currentTick(world.grids[0])!.cash).toBeCloseTo(
    cash - review.required,
    5,
  );
  expect(submit(review.buildKey)).toMatch(/terms changed/i);
  expect(world.grids[0].territoryNetwork?.tilePurchases).toHaveLength(1);
  expect(currentTick(world.grids[0])!.cash).toBeCloseTo(
    cash - review.required,
    5,
  );
});

it.each([
  "champlain:city",
  "valley-electric:site-1",
  "champlain:site-14",
  "invented",
  4,
  null,
])("host rejects invalid tile destination %s atomically", (id) => {
  const world = ready();
  const before = JSON.stringify(world.grids[0]);
  expect(build(world, id)).toBeDefined();
  expect(JSON.stringify(world.grids[0])).toBe(before);
});
it.each([106, 116])(
  "migrates recognized published schema15 scenario%i without changing generators, storage, finances or progress",
  (scenarioId) => {
    const world =
      scenarioId === 116 ? retainedStorageWorld() : ready(scenarioId);
    const raw = legacyCheckpoint(world);
    const before = JSON.stringify(raw);
    const restored = restoreWorld(raw, "upgraded");
    expect(restored.gameSchema).toBe(SAVE_SCHEMA_VERSION);
    expect(JSON.stringify(raw)).toBe(before);
    expect(restored.grids.map((grid) => currentTick(grid)!.cash)).toEqual(
      world.grids.map((grid) => currentTick(grid)!.cash),
    );
    expect(restored.grids.map((grid) => grid.facilities)).toEqual(
      JSON.parse(JSON.stringify(world.grids.map((grid) => grid.facilities))),
    );
    expect(restored.grids.map((grid) => currentTick(grid)!.storedWh)).toEqual(
      world.grids.map((grid) => currentTick(grid)!.storedWh),
    );
    expect(restored.grids.map((grid) => grid.objectiveProgress)).toEqual(
      world.grids.map((grid) => grid.objectiveProgress),
    );
    expect(
      new Set(restored.grids[0].facilities.map(({ tileId }) => tileId)).size,
    ).toBe(scenarioId === 116 ? restored.grids[0].facilities.length : 1);
    expect(
      restored.grids[0].facilities.every(({ tileId }) => tileId === undefined),
    ).toBe(scenarioId !== 116);
    raw.rules = "unrecognized";
    expect(() => restoreWorld(raw, "rejected")).toThrow();
  },
);
it("roundtrips and resumes migrated co-op storage deterministically", () => {
  const restored = restoreWorld(
    legacyCheckpoint(retainedStorageWorld()),
    "upgraded",
  );
  const roundtrip = restoreWorld(
    JSON.parse(JSON.stringify(checkpointWorld(restored))),
    "upgraded",
  );
  for (const continued of [restored, roundtrip]) {
    for (const seat of continued.seats)
      expect(
        applyCommand(continued, seat.id, {
          matchId: continued.matchId,
          epoch: continued.epoch,
          sequence: 1,
          command: { kind: "speed", speed: "NORMAL" },
        }),
      ).toBeUndefined();
    stepWorld(continued);
    expect(continued.grids[0].date.minute).toBe(TICK_MINUTES);
  }
  expect(JSON.parse(JSON.stringify(checkpointWorld(roundtrip)))).toEqual(
    JSON.parse(JSON.stringify(checkpointWorld(restored))),
  );
});
it.each([
  ["missing storage capacity", { peakWh: undefined }],
  ["string storage capacity", { peakWh: "50000000" }],
  ["string power", { peakW: "12500000" }],
  ["fractional identity", { id: 100.5 }],
  ["invalid operating cost", { annualOperatingCost: "bad" }],
])(
  "rejects recognized schema15 co-op storage with %s without modifying the checkpoint",
  (_label, changes) => {
    const raw = legacyCheckpoint(retainedStorageWorld());
    Object.assign(
      raw.grids[0].facilities.find(
        (facility: { id: number }) => facility.id === 100,
      ),
      changes,
    );
    const before = JSON.stringify(raw);
    expect(() => restoreWorld(raw, "rejected")).toThrow();
    expect(JSON.stringify(raw)).toBe(before);
  },
);

it("blocks the same physical fire front at a retained plains footprint for every seat", () => {
  const world = ready();
  // At this seeded summer reading, fire reaches (6,-4) on the unmodified board.
  const startsMinute = 7 * MINUTES_PER_MONTH;
  for (const grid of world.grids) {
    grid.seed = 11;
    grid.date = getDateFromMinute(
      startsMinute - TICK_MINUTES,
      grid.startingYear,
    );
    grid.territoryWeather = { dryness: 0.81, fires: [] };
  }
  world.grids[0].territoryNetwork!.legacyTiles!.push({
    id: "champlain:legacy-99",
    territoryId: "champlain",
    q: 6,
    r: -4,
    terrain: "plains",
    siteKind: "industrial",
    maxPeakW: 10e6,
  });
  for (const seat of world.seats) {
    const send = (command: Command) =>
      applyCommand(world, seat.id, {
        matchId: world.matchId,
        epoch: world.epoch,
        sequence: (world.sequences[seat.id] ?? 0) + 1,
        command,
      });
    expect(send({ kind: "speed", speed: "NORMAL" })).toBeUndefined();
    expect(send({ kind: "ready" })).toBeUndefined();
  }
  stepWorld(world);
  const fire = world.grids[0].territoryWeather!.fires[0];
  expect(fire.startsMinute).toBe(startsMinute);
  expect(fire.tiles.map(({ tileId }) => tileId)).not.toContain("frontier:6:-4");
  expect(world.grids[1].territoryWeather).toEqual(
    world.grids[0].territoryWeather,
  );
});
