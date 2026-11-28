import "../Store";
import {
  COOP_CUSTOM_FACILITY_LIMIT,
  TICK_MINUTES,
  TICKS_PER_DAY,
  YEARS_PER_TICK,
} from "../Constants";
import type { FacilityUpgradeType, FrontierTerritoryId } from "../Types";
import { isStorage } from "../Types";
import { DEMAND_TYPES } from "../data/DemandProfiles";
import { storagePowerW } from "../data/FacilityCapacity";
import { peerCorridorId } from "../data/Multiplayer";
import { facilityExpansionQuote } from "../helpers/FacilityExpansion";
import { currentTick } from "../helpers/GameSelectors";
import {
  multiplayerClaimQuote,
  multiplayerOwnedTileIds,
  multiplayerTerritoryClaimable,
  multiplayerTerritoryTile,
  multiplayerTerritoryTiles,
} from "../helpers/MultiplayerTerritory";
import { territoryHexDistance } from "../helpers/TerritoryTiles";
import { COOP_TEST_SPEC, coopSeats } from "../testing/MultiplayerFixtures";
import { loadSimData } from "../testing/SimData";
import type { Command, MatchSpec, World } from "./Types";
import { newMatchSpec } from "./WorkerProtocol";
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

test("rejects an oversized territorial opening fleet before generating the board", () => {
  const opening = COOP_TEST_SPEC.customScenario!;
  expect(() =>
    createWorld(
      {
        ...COOP_TEST_SPEC,
        territorialVersion: 1,
        customScenario: {
          ...opening,
          facilities: Array(COOP_CUSTOM_FACILITY_LIMIT + 1).fill(
            opening.facilities[0],
          ),
        },
      },
      coopSeats(4),
      "oversized-fleet",
      "opening",
    ),
  ).toThrow(/Choose a scenario or custom game/);
});

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

test("loads the published territorial board and routes rivers only for new matches", () => {
  loadSimData("PIT");
  try {
    const spec: MatchSpec = {
      ...COOP_TEST_SPEC,
      customScenario: {
        ...COOP_TEST_SPEC.customScenario!,
        locationId: "PIT",
        facilities: [{ name: "Solar", fuel: "Sun", peakW: 50e6 }],
      },
    };
    const seats = coopSeats(4);
    const pinnedTile = "frontier:2:-2";
    const v1 = createWorld(
      { ...spec, territorialVersion: 1 },
      seats,
      "pit-1",
      "epoch",
    );
    // Exact match recorded on the deployed master d6745546.
    const old = save(v1);
    old.rules =
      "coop-2-2042c23bfc633ac2af2ed66e310f561043f220bd925052f9167d9ef9b7d9db0a";
    expect(old.grids[3].multiplayer?.territorial?.startingTileIds).toEqual([
      "frontier:3:-3",
      "frontier:2:-3",
      pinnedTile,
      "frontier:4:-4",
    ]);
    const restored = hydrateWorld(old);
    expect(restored.grids[3].multiplayer?.territorial).toEqual(
      v1.grids[3].multiplayer?.territorial,
    );
    expect(
      multiplayerTerritoryTile(restored.grids[3], pinnedTile)?.terrain,
    ).not.toBe("river");

    const v2 = createWorld(newMatchSpec(spec), seats, "pit-1", "epoch");
    expect(v2.spec.territorialVersion).toBe(2);
    expect(v2.grids[3].multiplayer?.territorial?.startingTileIds).not.toContain(
      pinnedTile,
    );
    expect(multiplayerTerritoryTile(v2.grids[3], pinnedTile)?.terrain).toBe(
      "river",
    );
    expect(hydrateWorld(save(v2)).grids[3].multiplayer?.territorial).toEqual(
      v2.grids[3].multiplayer?.territorial,
    );
  } finally {
    loadSimData("SF");
  }
});

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

test.each([
  ["Natural Gas Peaker", ["combinedCycle"], "Natural Gas CC"],
  ["Coal", ["coalToGasCC"], "Natural Gas CC"],
  ["Coal", ["coalToGasPeaker"], "Natural Gas Peaker"],
  ["Coal", ["coalToGasPeaker", "combinedCycle"], "Natural Gas CC"],
] as const)(
  "restores a grandfathered %s after %j at its physical site",
  (name, upgrades, expectedName) => {
    const world = createWorld(
      {
        ...COOP_TEST_SPEC,
        territorialVersion: 1,
        customScenario: {
          ...COOP_TEST_SPEC.customScenario!,
          cash: 30e9,
          facilities: [
            {
              name,
              fuel: name === "Coal" ? "Coal" : "Natural Gas",
              peakW: name === "Coal" ? 3e9 : 2e9,
            },
            { name: "Natural Gas CC", fuel: "Natural Gas", peakW: 2e9 },
          ],
        },
      },
      coopSeats(2),
      "inherited-retrofit",
      "opening",
    );
    const seat = world.seats[0].id;
    const opening = world.grids[0].facilities.find(
      (plant) => plant.name === name,
    )!;
    const plant = () =>
      world.grids[0].facilities.find(({ id }) => id === opening.id)!;
    for (const { id } of world.seats)
      expect(
        send(world, id, { kind: "speed", speed: "NORMAL" }),
      ).toBeUndefined();
    for (const upgrade of upgrades satisfies readonly FacilityUpgradeType[]) {
      expect(
        action(world, seat, "retrofitFacility", {
          facilityId: opening.id,
          upgrade,
        }),
      ).toBeUndefined();
      const completion = plant().upgradeInProgress!.completesMinute;
      expect(() => hydrateWorld(save(world))).not.toThrow();
      while (world.grids[0].date.minute <= completion && !world.paused)
        stepWorld(world);
      expect(plant().upgradeInProgress).toBeUndefined();
    }
    expect(plant()).toMatchObject({
      id: opening.id,
      peakW: upgrades[0] === "coalToGasPeaker" ? 2e9 : opening.peakW,
      tileId: opening.tileId,
      name: expectedName,
    });
    const restored = restoreWorld(
      save(world),
      "restored",
      coopSeats(2, "new-"),
    );
    expect(
      restored.grids[0].facilities.find(({ id }) => id === opening.id),
    ).toEqual(plant());

    const tampered = save(world);
    const savedGrid = tampered.grids[0];
    const savedPlant = savedGrid.facilities.find(
      ({ id }) => id === opening.id,
    )!;
    savedPlant.peakW += 100e6;
    expect(() => hydrateWorld(tampered)).toThrow(/invalid grids/i);
    savedPlant.peakW = plant().peakW;
    savedPlant.tileId = multiplayerOwnedTileIds(savedGrid).find(
      (tileId) =>
        tileId !== savedGrid.multiplayer!.territorial!.homeTileId &&
        savedGrid.facilities.every((facility) => facility.tileId !== tileId),
    );
    expect(savedPlant.tileId).toBeDefined();
    expect(() => hydrateWorld(tampered)).toThrow(/invalid grids/i);
    savedPlant.tileId = opening.tileId;
    savedPlant.id += 100;
    expect(() => hydrateWorld(tampered)).toThrow(/invalid grids/i);
    savedPlant.id = opening.id;
    Object.assign(savedPlant, {
      name: "Oil",
      fuel: "Oil",
      gasCycle: undefined,
    });
    expect(() => hydrateWorld(tampered)).toThrow(/invalid grids/i);
  },
);

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

test("opening forecasts reflect each company's wind site before anyone acts", () => {
  const world = createWorld(
    {
      ...COOP_TEST_SPEC,
      territorialVersion: 1,
      customScenario: {
        ...COOP_TEST_SPEC.customScenario!,
        seed: 1,
        facilities: [{ name: "Wind", fuel: "Wind", peakW: 60e6 }],
      },
    },
    coopSeats(4),
    "wind-siting",
    "opening",
  );
  const sites = world.grids.map((grid) => {
    const [current, next] = roomView(world, grid.multiplayer!.seat).game!
      .timeline;
    return {
      terrain: multiplayerTerritoryTile(grid, grid.facilities[0].tileId)
        ?.terrain,
      currentSupply: current.supplyW,
      nextSupply: next.supplyW,
    };
  });
  const hills = sites.find(({ terrain }) => terrain === "hills");
  const forest = sites.find(({ terrain }) => terrain === "forest");
  expect(hills).toBeDefined();
  expect(forest).toBeDefined();
  expect(hills!.currentSupply).toBeGreaterThan(forest!.currentSupply);
  expect(hills!.nextSupply).toBeGreaterThan(forest!.nextSupply);
});

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

test.each([
  ["Wind", 1e9],
  ["Battery", 5e9],
] as const)(
  "rejects a booked %s expansion beyond its territorial site capacity",
  (name, forgedSize) => {
    const world = createWorld(
      {
        ...COOP_TEST_SPEC,
        territorialVersion: 1,
        customScenario: {
          ...COOP_TEST_SPEC.customScenario!,
          startingYear: 2035,
          facilities: [
            { name: "Wind", fuel: "Wind", peakW: 60e6 },
            { name: "Battery", peakWh: 50e6 },
          ],
        },
      },
      coopSeats(2),
      "expansion-capacity",
      "opening",
    );
    const [grid] = world.grids;
    const plant = grid.facilities.find((facility) => facility.name === name)!;
    const quote = facilityExpansionQuote(grid, plant.id, 100e6);
    if (quote.status !== "ready") throw new Error(quote.reason);
    expect(
      action(world, "0", "expandFacility", {
        facilityId: plant.id,
        targetSize: quote.targetSize,
        quoteKey: quote.quoteKey,
        financed: false,
      }),
    ).toBeUndefined();
    const checkpoint = save(world);
    const savedPlant = checkpoint.grids[0].facilities.find(
      ({ id }) => id === plant.id,
    )!;
    const project = savedPlant.expansionInProgress!;
    expect(
      hydrateWorld(checkpoint).grids[0].facilities.find(
        ({ id }) => id === plant.id,
      )?.expansionInProgress,
    ).toEqual(project);

    // Keep the stored review terms coherent while exceeding what this tile can host.
    project.targetSize = forgedSize;
    if (isStorage(savedPlant)) {
      project.targetPeakWh = forgedSize;
      project.targetPeakW =
        savedPlant.peakW +
        storagePowerW(name, forgedSize) -
        storagePowerW(name, savedPlant.peakWh);
    } else {
      project.targetPeakW = forgedSize;
    }
    const reviewed = JSON.parse(project.quoteKey);
    reviewed[3] = project.targetSize;
    reviewed[4] = project.targetPeakW;
    project.quoteKey = JSON.stringify(reviewed);
    expect(() => hydrateWorld(checkpoint)).toThrow(/invalid grids/i);
  },
);

test("a withdrawn or replaced proposal cannot be accepted from an older room view", () => {
  const world = create();
  for (const tile of expansionPath(world)) claim(world, "0", tile);
  const corridorId = peerCorridorId(world.edges[0].id);
  const border = roomView(world, "0").game!.multiplayer!.peers![0].border;
  const submit = (seat: string, decision: object) =>
    action(world, seat, "buildTransmissionLine", {
      corridorId,
      financed: false,
      ...decision,
    });
  const propose = { intent: "propose", border };
  expect(submit("0", propose)).toBeUndefined();
  const firstRevision = world.revision;
  const staleAcceptance = { intent: "accept", proposalRevision: firstRevision };
  expect(
    submit("0", { intent: "withdraw", proposalRevision: firstRevision }),
  ).toBeUndefined();

  expect(submit("1", staleAcceptance)).toMatch(/proposal changed/i);
  expect(world.edges[0].proposal).toBeUndefined();

  expect(submit("0", propose)).toBeUndefined();
  const secondRevision = world.revision;
  expect(submit("1", staleAcceptance)).toMatch(/proposal changed/i);
  expect(world.edges[0].proposal?.revision).toBe(secondRevision);
  expect(world.grids.every((grid) => !grid.transmission!.lines.length)).toBe(
    true,
  );
  const forged = save(world);
  forged.edges[0].proposal!.revision = forged.revision + 1;
  expect(() => hydrateWorld(forged)).toThrow(/invalid grids/i);
  expect(
    submit("1", { intent: "accept", proposalRevision: secondRevision }),
  ).toBeUndefined();
});

test("two bordering owners co-sign atomically, restore the crossing and trade only when it opens", () => {
  let world = create(3);
  const edge = world.edges[0];
  const corridorId = peerCorridorId(edge.id);
  const propose = { corridorId, financed: false, intent: "propose" };
  const path = expansionPath(world);
  expect(path.length).toBeGreaterThan(0);
  expect(
    action(world, "0", "buildTransmissionLine", {
      ...propose,
      border: { here: "frontier:0:0", there: "frontier:1:0" },
    }),
  ).toMatch(/border/);
  for (const tile of path) claim(world, "0", tile);
  const border = roomView(world, "0").game!.multiplayer!.peers![0].border!;
  expect(
    action(world, "2", "buildTransmissionLine", { ...propose, border }),
  ).toBeDefined();
  expect(
    action(world, "0", "buildTransmissionLine", {
      ...propose,
      border: { here: border.there, there: border.here },
    }),
  ).toMatch(/border crossing changed/);
  expect(
    action(world, "0", "buildTransmissionLine", { ...propose, border }),
  ).toBeUndefined();
  expect(roomView(world, "1").game!.multiplayer!.peers![0]).toMatchObject({
    connectionRequestedBy: "Player 0",
    connectionProposalRevision: world.revision,
    connected: false,
  });
  expect(
    world.grids.every((grid) => grid.transmission!.lines.length === 0),
  ).toBe(true);
  const accept = {
    corridorId,
    financed: false,
    intent: "accept",
    proposalRevision: world.revision,
  };
  const resumedSeats = coopSeats(3, "new");
  world = restoreWorld(save(world), "resumed", resumedSeats);
  const resumed = world.edges[0];
  expect(resumed.proposal).toMatchObject({
    seat: "new0",
    revision: accept.proposalRevision,
  });
  const cash = world.grids.map((grid) => currentTick(grid)!.cash);
  currentTick(world.grids[1])!.cash = 0;
  expect(action(world, "new1", "buildTransmissionLine", accept)).toMatch(
    /both companies/i,
  );
  expect(currentTick(world.grids[0])!.cash).toBe(cash[0]);
  expect(
    world.grids.every((grid) => grid.transmission!.lines.length === 0),
  ).toBe(true);
  currentTick(world.grids[1])!.cash = cash[1];
  expect(
    action(world, "new1", "buildTransmissionLine", accept),
  ).toBeUndefined();
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

  const upgrade = (seat: string, decision: object) =>
    action(world, seat, "upgradeTransmissionLine", {
      corridorId,
      financed: false,
      ...decision,
    });
  expect(upgrade("new0", { intent: "propose" })).toBeUndefined();
  const firstUpgrade = world.revision;
  expect(
    upgrade("new0", { intent: "withdraw", proposalRevision: firstUpgrade }),
  ).toBeUndefined();
  expect(upgrade("new0", { intent: "propose" })).toBeUndefined();
  const secondUpgrade = world.revision;
  expect(
    upgrade("new1", { intent: "accept", proposalRevision: firstUpgrade }),
  ).toMatch(/proposal changed/i);
  expect(
    roomView(world, "new1").game!.multiplayer!.peers![0]
      .upgradeProposalRevision,
  ).toBe(secondUpgrade);
  expect(hydrateWorld(save(world)).edges[0].approvalRevision).toBe(
    secondUpgrade,
  );
  expect(
    upgrade("new1", { intent: "accept", proposalRevision: secondUpgrade }),
  ).toBeUndefined();
  expect(resumed.approvalRevision).toBeUndefined();
  expect(world.grids[0].transmission!.lines[0].upgrade).toBeDefined();

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
