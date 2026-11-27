import "../Store";
import { TICK_MINUTES, TICKS_PER_DAY, YEARS_PER_TICK } from "../Constants";
import type { FrontierTerritoryId } from "../Types";
import { DEMAND_TYPES } from "../data/DemandProfiles";
import { peerCorridorId } from "../data/Multiplayer";
import { currentTick } from "../helpers/GameSelectors";
import {
  multiplayerClaimQuote,
  multiplayerOwnedTileIds,
  multiplayerTerritoryClaimable,
  multiplayerTerritoryTiles,
} from "../helpers/MultiplayerTerritory";
import { territoryHexDistance } from "../helpers/TerritoryTiles";
import { COOP_TEST_SPEC, coopSeats } from "../testing/MultiplayerFixtures";
import { loadSimData } from "../testing/SimData";
import type { Command, World } from "./Types";
import {
  applyCommand,
  checkpointWorld,
  createWorld,
  hydrateWorld,
  restoreWorld,
  roomView,
  stepWorld,
} from "./World";

beforeAll(() => loadSimData("SF"));

function create(count = 2) {
  return createWorld(
    { ...COOP_TEST_SPEC, territorialVersion: 1 },
    coopSeats(count),
    "territorial-SF",
    "opening",
  );
}

function save(world: World): World {
  return JSON.parse(JSON.stringify(checkpointWorld(world)));
}

function send(world: World, seat: string, command: Command) {
  return applyCommand(world, seat, {
    matchId: world.matchId,
    epoch: world.epoch,
    sequence: (world.sequences[seat] ?? 0) + 1,
    command,
  });
}

function action(world: World, seat: string, name: string, payload: unknown) {
  return send(world, seat, { kind: "action", name, payload });
}

function claim(world: World, seat: string, tileId: FrontierTerritoryId) {
  const quote = multiplayerClaimQuote(roomView(world, seat).game!, tileId);
  expect(quote).toBeDefined();
  expect(action(world, seat, "acquireTile", quote)).toBeUndefined();
}

/** Find a neutral path to the other company's border using the actual generated board. */
function expansionPath(world: World, from = 0, to = 1) {
  const board = multiplayerTerritoryTiles(world.grids[from]);
  const own = multiplayerOwnedTileIds(world.grids[from]);
  const target = new Set(multiplayerOwnedTileIds(world.grids[to]));
  const seen = new Set(world.grids.flatMap(multiplayerOwnedTileIds));
  const queue = board
    .filter((tile) => own.includes(tile.id))
    .map((tile) => ({
      tile,
      path: [] as FrontierTerritoryId[],
    }));
  for (const { tile, path } of queue) {
    if (
      board.some(
        (other) =>
          target.has(other.id) && territoryHexDistance(tile, other) === 1,
      )
    )
      return path;
    for (const next of board) {
      if (
        seen.has(next.id) ||
        !multiplayerTerritoryClaimable(next) ||
        territoryHexDistance(tile, next) !== 1
      )
        continue;
      seen.add(next.id);
      queue.push({ tile: next, path: [...path, next.id] });
    }
  }
  throw new Error("Fixture companies cannot reach a shared border");
}

test.each([2, 3, 4])(
  "starts %i companies on one disjoint board without free interties",
  (count) => {
    const world = create(count);
    const initial = world.grids.map(multiplayerOwnedTileIds);
    expect(new Set(initial.flat()).size).toBe(initial.flat().length);
    expect(initial).toEqual(create(count).grids.map(multiplayerOwnedTileIds));
    expect(world.edges).toHaveLength((count * (count - 1)) / 2);
    expect(
      world.edges.every(({ ratingW, flowW }) => ratingW === 0 && flowW === 0),
    ).toBe(true);
    for (const [index, grid] of world.grids.entries()) {
      expect(grid.transmission!.lines).toHaveLength(0);
      expect(
        grid.facilities.every((facility) =>
          initial[index].some((id) => id === facility.tileId),
        ),
      ).toBe(true);
      const seat = world.seats[index];
      const view = roomView(world, seat.id).game!;
      const peer = (index + 1) % count;
      const foreign = world.grids[peer].facilities[0].tileId!;
      expect(view.multiplayer!.tileOwners![foreign]?.seat).toBe(
        world.seats[peer].id,
      );
      expect(view.multiplayer!.tileFacilities![foreign]?.name).toBe(
        world.grids[peer].facilities[0].name,
      );
      expect(grid.multiplayer!.tileOwners).toBeUndefined();
    }
    expect(
      hydrateWorld(save(world)).grids.map(multiplayerOwnedTileIds),
    ).toEqual(initial);
  },
);

test("a host orders competing claims and charges only the winning company", () => {
  const world = create();
  const board = multiplayerTerritoryTiles(world.grids[0]);
  const path = expansionPath(world);
  for (const tile of path.slice(0, -1)) claim(world, "0", tile);
  const first = roomView(world, "0").game!;
  const second = roomView(world, "1").game!;
  const candidate = board.find(
    (tile) =>
      multiplayerClaimQuote(first, tile.id) &&
      multiplayerClaimQuote(second, tile.id),
  )!;
  expect(candidate).toBeDefined();
  const quotes = [first, second].map((grid) =>
    multiplayerClaimQuote(grid, candidate.id)!,
  );
  const cash = world.grids.map((grid) => currentTick(grid)!.cash);
  expect(action(world, "1", "acquireTile", quotes[1])).toBeUndefined();
  expect(action(world, "0", "acquireTile", quotes[0])).toMatch(
    /unavailable|owned/,
  );
  expect(currentTick(world.grids[0])!.cash).toBe(cash[0]);
  expect(currentTick(world.grids[1])!.cash).toBe(cash[1] - quotes[1].price);
  expect(
    roomView(world, "0").game!.multiplayer!.tileOwners![candidate.id]?.seat,
  ).toBe("1");
  expect(
    hydrateWorld(save(world)).grids[1].multiplayer!.territorial!.claims,
  ).toEqual([{ tileId: candidate.id, price: quotes[1].price, minute: 0 }]);
  const forged = save(world);
  forged.grids[0].multiplayer!.territorial!.claims.push({
    tileId: candidate.id,
    price: quotes[0].price,
    minute: 0,
  });
  expect(() => hydrateWorld(forged)).toThrow(/invalid grids/i);
  const incomplete = save(world);
  const malformedClaims: unknown[] =
    incomplete.grids[0].multiplayer!.territorial!.claims;
  malformedClaims.push({
    tileId: "frontier:999:999",
    minute: 0,
  });
  expect(() => hydrateWorld(incomplete)).toThrow(/invalid grids/i);
});

test("construction is booked on an owned vacant tile only and exact placements survive restore", () => {
  const world = create();
  const [own, peer] = world.grids;
  const existing = own.facilities.length;
  const peerTile = multiplayerOwnedTileIds(peer)[0];
  const build = { facility: { name: "Wind", peakW: 5e6 }, financed: false };
  expect(
    action(world, "0", "buildFacility", { ...build, tileId: peerTile }),
  ).toBeDefined();
  expect(own.facilities).toHaveLength(existing);
  expect(action(world, "0", "buildFacility", build)).toBeUndefined();
  const added = world.grids[0].facilities.at(-1)!;
  expect(added.tileId).toBeDefined();
  expect(multiplayerOwnedTileIds(world.grids[0])).toContain(added.tileId);
  expect(
    action(world, "0", "buildFacility", { ...build, tileId: added.tileId }),
  ).toBeDefined();
  expect(world.grids[0].facilities).toHaveLength(existing + 1);
  expect(
    restoreWorld(save(world), "restored").grids[0].facilities.at(-1)?.tileId,
  ).toBe(added.tileId);
  const forged = save(world);
  forged.grids[0].facilities.at(-1)!.tileId = peerTile;
  expect(() => hydrateWorld(forged)).toThrow(/invalid grids/i);
});

test("two bordering owners co-sign atomically, restore the crossing and trade only when it opens", () => {
  let world = create(3);
  const edge = world.edges[0];
  const corridorId = peerCorridorId(edge.id);
  const order = { corridorId, financed: false };
  const path = expansionPath(world);
  expect(path.length).toBeGreaterThan(0);
  expect(action(world, "0", "buildTransmissionLine", order)).toMatch(/border/);
  for (const tile of path) claim(world, "0", tile);
  expect(action(world, "2", "buildTransmissionLine", order)).toBeDefined();
  expect(action(world, "0", "buildTransmissionLine", order)).toBeUndefined();
  expect(roomView(world, "1").game!.multiplayer!.peers![0]).toMatchObject({
    connectionRequestedBy: "Player 0",
    connected: false,
  });
  expect(
    world.grids.every((grid) => grid.transmission!.lines.length === 0),
  ).toBe(true);
  const resumedSeats = coopSeats(3, "new");
  world = restoreWorld(save(world), "resumed", resumedSeats);
  const resumed = world.edges[0];
  expect(resumed.proposal?.seat).toBe("new0");
  const cash = world.grids.map((grid) => currentTick(grid)!.cash);
  currentTick(world.grids[1])!.cash = 0;
  expect(action(world, "new1", "buildTransmissionLine", order)).toMatch(
    /both companies/i,
  );
  expect(currentTick(world.grids[0])!.cash).toBe(cash[0]);
  expect(
    world.grids.every((grid) => grid.transmission!.lines.length === 0),
  ).toBe(true);
  currentTick(world.grids[1])!.cash = cash[1];
  expect(action(world, "new1", "buildTransmissionLine", order)).toBeUndefined();
  for (const [i, grid] of world.grids.slice(0, 2).entries()) {
    expect(grid.transmission!.lines[0].yearsToBuildLeft).toBeGreaterThan(0);
    expect(currentTick(grid)!.cash).toBe(
      cash[i] - grid.transmission!.lines[0].buildCost,
    );
  }
  const saveUnderConstruction = save(world);
  expect(hydrateWorld(saveUnderConstruction).edges[0].crossing).toEqual(
    resumed.crossing,
  );
  const forged = save(world);
  forged.edges[0].crossing!.b =
    world.grids[2].multiplayer!.territorial!.homeTileId;
  expect(() => hydrateWorld(forged)).toThrow(/invalid grids/i);
  expect(
    action(
      world,
      "new0",
      "cancelTransmissionLine",
      world.grids[0].transmission!.lines[0].id,
    ),
  ).toBeDefined();
  for (const seat of resumedSeats)
    expect(send(world, seat.id, { kind: "ready" })).toBeUndefined();
  stepWorld(world);
  expect(resumed).toMatchObject({ disabled: true, flowW: 0, ratingW: 0 });

  // Put paid projects one advancement from completion and give one owner a shortage.
  for (const [i, grid] of world.grids.entries()) {
    const line = grid.transmission!.lines.find(
      (entry) => entry.corridorId === corridorId,
    );
    if (line) line.yearsToBuildLeft = YEARS_PER_TICK;
    const next = grid.timeline.find(
      (frame) => frame.minute === grid.date.minute + TICK_MINUTES,
    )!;
    next.demandW = i === 1 ? 300e6 : 0;
    for (const type of DEMAND_TYPES)
      next.demandByType[type] = type === "Residential" ? next.demandW : 0;
  }
  stepWorld(world);
  expect(resumed.disabled).toBe(false);
  expect(resumed.ratingW).toBeGreaterThan(0);
  expect(resumed.flowW).toBeGreaterThan(0);
  expect(resumed.flowW).toBeLessThanOrEqual(resumed.ratingW);
  expect(currentTick(world.grids[0])!.exportedW).toBe(resumed.flowW);
  expect(currentTick(world.grids[1])!.importedW).toBe(resumed.flowW);
  expect(roomView(world, "new1").game!.multiplayer!.peers![0]).toMatchObject({
    connected: true,
    endpoints: { here: resumed.crossing!.b, there: resumed.crossing!.a },
  });
  expect(hydrateWorld(save(world)).edges[0]).toEqual(resumed);

  currentTick(world.grids[1])!.cash = -1e12;
  for (let i = 0; i < 2 * TICKS_PER_DAY && !world.outcomes["new1"]; i++)
    stepWorld(world);
  expect(world.outcomes["new1"]?.outcome).toBe("bankrupt");
  expect(resumed).toMatchObject({ disabled: true, ratingW: 0, flowW: 0 });
  expect(currentTick(world.grids[0])!.cash).toBeGreaterThan(0);
  expect(
    roomView(world, "new0").game!.multiplayer!.peers!.find(
      ({ id }) => id === "new1",
    ),
  ).toMatchObject({ retired: true, connected: false, ratingW: 0 });
  expect(hydrateWorld(save(world)).edges[0]).toEqual(resumed);
});
