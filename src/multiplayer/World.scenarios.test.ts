import "../Store";
import { loadSimData } from "../testing/SimData";
import { currentTick } from "../helpers/GameSelectors";
import { pendingScenarioChoice } from "../helpers/ScenarioChoices";
import { corridorsForGame } from "../data/IntertieAccess";
import { getScenario, TUTORIALS } from "../data/Scenarios";
import { COOP_TEST_SPEC, coopSeats } from "../testing/MultiplayerFixtures";
import {
  applyCommand,
  checkpointWorld,
  createWorld,
  restoreWorld,
  roomView,
  stepWorld,
} from "./World";
import type { Command, MatchSpec, World } from "./Types";

function command(world: World, player: number, action: Command) {
  return applyCommand(world, String(player), {
    matchId: world.matchId,
    epoch: world.epoch,
    sequence: (world.sequences[String(player)] || 0) + 1,
    command: action,
  });
}
function start(spec: MatchSpec, count: number) {
  const world = createWorld(spec, coopSeats(count), "match", "epoch");
  world.seats.forEach((_seat, i) => command(world, i, { kind: "ready" }));
  return world;
}

test("an authored scenario starts every company identically in its own city", () => {
  const deepFreeze = getScenario(107)!;
  loadSimData(deepFreeze.location!);
  const world = start({ scenarioId: 107, difficulty: "Manager" }, 3);
  world.grids.forEach((game, index) => {
    expect(game.scenarioId).toBe(107);
    expect(game.difficulty).toBe("Manager");
    expect(game.location.id).toBe("Austin");
    expect(game.startingYear).toBe(deepFreeze.startingYear);
    expect(game.seed).toBe(world.grids[0].seed);
    expect(game.facilities.map((f) => [f.name, f.peakW])).toEqual(
      world.grids[0].facilities.map((f) => [f.name, f.peakW]),
    );
    // Player links replace every outside market the scenario would offer.
    expect(corridorsForGame(game).map((c) => c.name)).toEqual(
      world.seats.filter((_s, i) => i !== index).map((s) => s.name),
    );
  });
  stepWorld(world);
  expect(new Set(world.grids.map((g) => g.date.minute)).size).toBe(1);
});

test("tutorials, unknown scenarios and mismatched custom specs are refused", () => {
  loadSimData("SF");
  const seats = coopSeats(2);
  for (const spec of [
    { scenarioId: TUTORIALS[0].id, difficulty: "Employee" },
    { scenarioId: 987654, difficulty: "Employee" },
    { ...COOP_TEST_SPEC, customScenario: undefined },
    { ...COOP_TEST_SPEC, difficulty: "Overlord" },
  ] as MatchSpec[])
    expect(() => createWorld(spec, seats, "match", "epoch")).toThrow(
      /scenario or custom game/,
    );
});

test("a scenario choice holds the shared clock until every company answers", () => {
  loadSimData(getScenario(106)!.locationId!);
  const world = start({ scenarioId: 106, difficulty: "Employee" }, 2);
  // Data Center asks before its first new campus load.
  for (let tick = 0; tick < 49 * 96 && !world.paused; tick++) stepWorld(world);
  expect(world.grids.every((g) => pendingScenarioChoice(g))).toBe(true);
  expect(world.paused).toBe(true);
  expect(world.reason).toMatch(/Player 0: Choosing a response/);
  const minute = world.grids[0].date.minute;
  stepWorld(world);
  expect(world.grids[0].date.minute).toBe(minute);
  const answer: Command = {
    kind: "action",
    name: "chooseScenarioResponse",
    payload: {
      decisionId: pendingScenarioChoice(world.grids[0])!.id,
      optionId: "phased",
    },
  };
  expect(command(world, 0, answer)).toBeUndefined();
  expect(world.paused).toBe(true);
  expect(world.reason).not.toMatch(/Player 0/);
  expect(world.reason).toMatch(/Player 1: Choosing a response/);
  expect(
    roomView(world, "0").game!.multiplayer!.clock!.players[1].pauseReason,
  ).toBe("Choosing a response");
  expect(command(world, 1, answer)).toBeUndefined();
  expect(world.paused).toBe(false);
  stepWorld(world);
  expect(world.grids[0].date.minute).toBe(minute + 15);
});

function retireBankrupt(world: World, player: number) {
  currentTick(world.grids[player])!.cash = -1e12;
  for (let tick = 0; tick < 2 * 96 && !world.outcomes[player]; tick++)
    stepWorld(world);
}

test("a bankrupt company retires while everyone else keeps playing", () => {
  loadSimData("SF");
  const world = start(COOP_TEST_SPEC, 3);
  retireBankrupt(world, 1);
  expect(world.outcomes["1"]).toMatchObject({
    outcome: "bankrupt",
    title: "Bankrupt!",
  });
  expect(world.outcomes["0"]).toBeUndefined();
  const frozen = world.grids[1].date.minute;
  // A retired company no longer holds the clock: its pause and menus are ignored.
  expect(command(world, 1, { kind: "speed", speed: "PAUSED" })).toBeUndefined();
  expect(
    command(world, 1, { kind: "activity", reason: "Building capacity" }),
  ).toBeUndefined();
  expect(world.paused).toBe(false);
  for (let tick = 0; tick < 96; tick++) stepWorld(world);
  expect(world.grids[1].date.minute).toBe(frozen);
  expect(world.grids[0].date.minute).toBe(world.grids[2].date.minute);
  expect(world.grids[0].date.minute).toBeGreaterThan(frozen);
  for (const edge of world.edges.filter((e) => [e.a, e.b].includes("1"))) {
    expect(edge.disabled).toBe(true);
    expect(edge.flowW).toBe(0);
  }
  expect(command(world, 1, { kind: "rate", value: 0.1 }) ?? "accepted").toMatch(
    /run has ended/,
  );
  const view = roomView(world, "0");
  expect(
    view.game!.multiplayer!.peers!.find((p) => p.id === "1"),
  ).toMatchObject({ retired: true, availableSupplyW: 0, ratingW: 0 });
  expect(view.game!.multiplayer!.results).toEqual([
    expect.objectContaining({ id: "1", outcome: "bankrupt" }),
  ]);
  expect(view.grids[1].retired).toBe(true);
  expect(view.game!.multiplayer!.clock!.players.map((p) => p.id)).toEqual([
    "0",
    "2",
  ]);
  // A joint upgrade with a retired company is refused.
  const corridorId = view.game!.multiplayer!.peers!.find((p) => p.id === "1")!
    .corridor.id;
  expect(
    command(world, 0, {
      kind: "action",
      name: "upgradeTransmissionLine",
      payload: { corridorId, financed: false },
    }),
  ).toMatch(/Player 1's company has retired/);
});

test("the match ends once every company reaches the scenario's term", () => {
  loadSimData("SF");
  const spec: MatchSpec = {
    ...COOP_TEST_SPEC,
    customScenario: { ...COOP_TEST_SPEC.customScenario!, durationMonths: 1 },
  };
  const world = start(spec, 2);
  for (let tick = 0; tick < 2 * 96 && !world.paused; tick++) stepWorld(world);
  expect(Object.values(world.outcomes).map((o) => o.outcome)).toEqual([
    "completed",
    "completed",
  ]);
  expect(world.paused).toBe(true);
  expect(world.reason).toBe("Match complete");
  // Nobody is left to run the clock, whatever a player selects.
  command(world, 0, { kind: "speed", speed: "NORMAL" });
  expect(world.paused).toBe(true);
  expect(command(world, 0, { kind: "ready" })).toMatch(/complete/);
});

test("a saved match restores retired companies frozen and rejects a changed spec", () => {
  loadSimData("SF");
  const world = start(COOP_TEST_SPEC, 3);
  retireBankrupt(world, 2);
  for (let tick = 0; tick < 4; tick++) stepWorld(world);
  const saved = JSON.parse(JSON.stringify(checkpointWorld(world)));
  const restored = restoreWorld(saved, "restored");
  expect(restored.outcomes["2"].outcome).toBe("bankrupt");
  expect(restored.grids[2].date.minute).toBeLessThan(
    restored.grids[0].date.minute,
  );
  expect(() =>
    restoreWorld(
      { ...saved, spec: { ...saved.spec, difficulty: "CEO" } },
      "restored",
    ),
  ).toThrow(/incomplete|original game build/);
  expect(() => restoreWorld({ ...saved, schema: 1 }, "restored")).toThrow();
});

test("co-op preserves the wildfire mission's pivotal existing intertie and its outage", () => {
  loadSimData("LA");
  const world = start({ scenarioId: 111, difficulty: "Manager" }, 2);
  for (const game of world.grids) {
    expect(
      game.transmission!.lines.find(
        (line) => line.corridorId === "california-north",
      ),
    ).toMatchObject({ capacityW: 40e6, yearsToBuildLeft: 0 });
    expect(new Set(game.transmission!.lines.map((line) => line.id)).size).toBe(
      2,
    );
  }
  stepWorld(world);
  expect(world.grids.every((game) => currentTick(game)!.importedW! > 0)).toBe(
    true,
  );
  for (
    let tick = 0;
    tick < 36 * 96 && world.grids[0].date.monthsElapsed < 36;
    tick++
  ) {
    if (world.paused)
      world.seats.forEach((_seat, i) => command(world, i, { kind: "ready" }));
    stepWorld(world);
  }
  expect(world.grids[0].date.monthsElapsed).toBe(36);
  for (const game of world.grids) {
    const north = game.transmission!.lines.find(
      (line) => line.corridorId === "california-north",
    )!;
    expect(Math.abs(north.currentFlowW)).toBeLessThanOrEqual(4e6);
    expect(currentTick(game)!.transmissionCapacityLimitsWByCorridor).toEqual({
      "california-north": 4e6,
    });
  }
  const restored = restoreWorld(
    JSON.parse(JSON.stringify(checkpointWorld(world))),
    "new-epoch",
  );
  const northernConnections = (match: World) =>
    match.grids.map((game) =>
      game.transmission!.lines.find(
        (line) => line.corridorId === "california-north",
      ),
    );
  expect(northernConnections(restored)).toEqual(northernConnections(world));
});

test("an existing outside intertie upgrades without charging a peer or requiring a co-signature", () => {
  loadSimData("LA");
  const world = start({ scenarioId: 111, difficulty: "Manager" }, 2);
  expect(
    command(world, 0, {
      kind: "action",
      name: "upgradeTransmissionLine",
      payload: { corridorId: "california-north", financed: true },
    }),
  ).toBeUndefined();
  expect(
    world.grids[0].transmission!.lines.find(
      (line) => line.corridorId === "california-north",
    )!.upgrade,
  ).toBeDefined();
  expect(
    world.grids[1].transmission!.lines.find(
      (line) => line.corridorId === "california-north",
    )!.upgrade,
  ).toBeUndefined();
  expect(world.edges.every((edge) => !edge.approval)).toBe(true);
  expect(() =>
    restoreWorld(
      JSON.parse(JSON.stringify(checkpointWorld(world))),
      "restored-upgrade",
    ),
  ).not.toThrow();
});
