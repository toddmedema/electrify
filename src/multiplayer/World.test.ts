import "../Store";
import { loadSimData } from "../testing/SimData";
import { currentTick } from "../helpers/GameSelectors";
import {
  applyCommand,
  checkpointWorld,
  matchScenario,
  createWorld,
  pauseWorld,
  restoreWorld,
  roomView,
  stepWorld,
} from "./World";
import type { Command, World } from "./Types";
import { corridorsForGame } from "../data/IntertieAccess";
import { parseSave, serializeSave } from "../SaveGame";
import { COOP_TEST_SPEC, coopSeats } from "../testing/MultiplayerFixtures";
import { DIFFICULTY_IDS } from "../Constants";
import { validBrowseState } from "./Browse";

beforeAll(() => {
  loadSimData("SF");
});
function create(count = 4) {
  return createWorld(COOP_TEST_SPEC, coopSeats(count), "match", "epoch");
}
function command(world: World, player: number, action: Command) {
  return applyCommand(world, String(player), {
    matchId: world.matchId,
    epoch: world.epoch,
    sequence: (world.sequences[String(player)] || 0) + 1,
    command: action,
  });
}

test("running speed choices consent to a safety resume atomically, including reselecting the same speed", () => {
  const world = create(3);
  expect(command(world, 0, { kind: "speed", speed: "NORMAL" })).toBeUndefined();
  expect(world.ready).toEqual(["0"]);
  expect(world.speed).toBe("PAUSED");
  command(world, 1, { kind: "speed", speed: "ULTRA" });
  command(world, 2, { kind: "speed", speed: "PAUSED" });
  expect(world.ready).toEqual(["0", "1"]);
  expect(world.readyRequired).toBe(true);
  command(world, 2, { kind: "speed", speed: "SLOW" });
  expect(world.readyRequired).toBe(false);
  expect(world.speed).toBe("SLOW");
  expect(world.selectedSpeeds).toEqual({ 0: "NORMAL", 1: "ULTRA", 2: "SLOW" });
  pauseWorld(world, "Player reconnected");
  command(world, 0, { kind: "speed", speed: "NORMAL" });
  command(world, 1, { kind: "speed", speed: "ULTRA" });
  command(world, 2, { kind: "activity", reason: "Reading settings" });
  command(world, 2, { kind: "speed", speed: "SLOW" });
  expect(world.readyRequired).toBe(false);
  expect(world.speed).toBe("PAUSED");
  command(world, 2, { kind: "activity", reason: null });
  expect(world.speed).toBe("SLOW");
});

test("resume guidance is a clock presentation reason, never a reported local activity", () => {
  const world = create(2);
  let view = roomView(world, "0");
  expect(
    view.game!.multiplayer!.clock!.players.map((p) => p.pauseReason),
  ).toEqual(["Select a speed to resume", "Select a speed to resume"]);
  expect(view.grids.map((g) => g.pauseReason)).toEqual([undefined, undefined]);
  expect(world.activities).toEqual({});
  command(world, 0, { kind: "speed", speed: "NORMAL" });
  command(world, 1, { kind: "activity", reason: "Building power plants" });
  view = roomView(world, "0");
  expect(
    view.game!.multiplayer!.clock!.players.map((p) => p.pauseReason),
  ).toEqual([undefined, "Building power plants"]);
  expect(view.grids[1].pauseReason).toBe("Building power plants");
});

test("speed readiness cannot bypass a disconnected player or the campaign end", () => {
  const world = create(2);
  const envelope = {
    matchId: world.matchId,
    epoch: world.epoch,
    sequence: 1,
    command: { kind: "speed" as const, speed: "ULTRA" as const },
  };
  expect(applyCommand(world, "0", envelope, false)).toMatch(/reconnect/);
  expect(world.ready).toEqual([]);
  expect(world.selectedSpeeds["0"]).toBe("NORMAL");
  expect(world.speed).toBe("PAUSED");
  world.seats.forEach((seat) => {
    world.outcomes[seat.id] = {
      outcome: "completed",
      title: "Done",
      month: 60,
    };
  });
  expect(applyCommand(world, "0", { ...envelope, sequence: 2 }, true)).toMatch(
    /complete/,
  );
  expect(world.readyRequired).toBe(true);
  expect(world.ready).toEqual([]);
});
test.each([2, 3, 4])(
  "%i real grids share a clock and always have a complete graph including islands",
  (count) => {
    const world = create(count);
    expect(world.edges).toHaveLength((count * (count - 1)) / 2);
    world.grids.forEach((game, index) => {
      const others = world.seats.filter((_seat, i) => i !== index);
      expect(
        corridorsForGame(game)
          .map((c) => c.name)
          .sort(),
      ).toEqual(others.map((s) => s.name).sort());
      expect(game.transmission!.lines).toHaveLength(count - 1);
      expect(
        game.transmission!.lines.every(
          (line) =>
            line.corridorId.startsWith("peer:") &&
            line.yearsToBuildLeft === 0 &&
            !line.upgrade &&
            line.loanAmountLeft === 0,
        ),
      ).toBe(true);
      expect(game.transmission!.lines.map((line) => line.name).sort()).toEqual(
        others.map((s) => s.name).sort(),
      );
      expect(parseSave(serializeSave(game))).toBeNull();
    });
    world.grids.forEach((g) =>
      expect(g.facilities.map((f) => f.name)).toContain("Natural Gas CC"),
    );
    for (let i = 0; i < count; i++)
      expect(command(world, i, { kind: "ready" })).toBeUndefined();
    for (let tick = 0; tick < 200; tick++) stepWorld(world);
    expect(new Set(world.grids.map((g) => g.date.minute)).size).toBe(1);
    expect(world.grids[0].date.monthsElapsed).toBeGreaterThan(0);
    world.grids.forEach((g) =>
      expect(Number.isFinite(currentTick(g)!.cash)).toBe(true),
    );
    const minute = world.grids[0].date.minute;
    command(world, 1, { kind: "pause" });
    stepWorld(world);
    expect(world.grids.every((g) => g.date.minute === minute)).toBe(true);
    const view = roomView(world, "1");
    expect(view.game?.transmission?.lines).toHaveLength(count - 1);
    view.game?.multiplayer?.peers?.forEach((peer) => {
      expect(peer.ratingW).toBe(
        world.edges.find((edge) => `peer:${edge.id}` === peer.corridor.id)!
          .ratingW,
      );
    });
  },
);
test("paused commands apply immediately and duplicate financed purchases never charge twice", () => {
  const world = create(2),
    before = currentTick(world.grids[0])!.cash;
  const envelope = {
    matchId: "match",
    epoch: "epoch",
    sequence: 1,
    command: {
      kind: "action" as const,
      name: "buildFacility",
      payload: { facility: { name: "Wind", peakW: 50e6 }, financed: true },
    },
  };
  expect(applyCommand(world, "0", envelope)).toBeUndefined();
  const after = currentTick(world.grids[0])!.cash;
  expect(after).toBeLessThan(before);
  expect(world.grids[0].date.minute).toBe(0);
  expect(applyCommand(world, "0", envelope)).toBeUndefined();
  expect(currentTick(world.grids[0])!.cash).toBe(after);
  expect(
    world.grids[0].facilities.filter((f) => f.name === "Wind"),
  ).toHaveLength(2);
  expect(
    applyCommand(world, "0", { ...envelope, epoch: "old", sequence: 2 }),
  ).toMatch(/another session/);
  expect(applyCommand(world, "outsider", envelope)).toMatch(/another session/);
});
test("commands leave no reducer-frozen objects in the grid the clock mutates", () => {
  const world = create(2);
  command(world, 0, {
    kind: "action" as const,
    name: "buildFacility",
    payload: { facility: { name: "Wind", peakW: 50e6 }, financed: true },
  });
  command(world, 0, { kind: "rate", value: 0.1 });
  const frozen: string[] = [];
  const visit = (value: unknown, path: string) => {
    if (!value || typeof value !== "object") return;
    if (Object.isFrozen(value)) frozen.push(path);
    else Object.entries(value).forEach(([k, v]) => visit(v, `${path}.${k}`));
  };
  visit(world.grids[0], "grid");
  expect(frozen).toEqual([]);
});
test("running gas supplies a neighbor's shortage and settles both energy and money once", () => {
  const world = create(2);
  const receiver = world.grids[1];
  for (const plant of [...receiver.facilities])
    command(world, 1, {
      kind: "action",
      name: "togglePauseFacility",
      payload: plant.id,
    });
  command(world, 0, { kind: "ready" });
  command(world, 1, { kind: "ready" });
  stepWorld(world);
  const sent = world.edges[0].flowW;
  expect(sent).toBeGreaterThan(0);
  expect(currentTick(world.grids[0])!.exportedW).toBeCloseTo(sent, 3);
  expect(currentTick(world.grids[1])!.importedW).toBeCloseTo(sent, 3);
  expect(currentTick(world.grids[0])!.revenueExports).toBeCloseTo(
    currentTick(world.grids[1])!.expensesImports,
    3,
  );
  expect(currentTick(world.grids[1])!.importedKgco2e).toBeGreaterThan(0);
  command(world, 0, { kind: "pause" });
  const recorded = { ...currentTick(world.grids[1])! };
  command(world, 1, {
    kind: "action" as const,
    name: "buildFacility",
    payload: { facility: { name: "Wind", peakW: 50e6 }, financed: true },
  });
  expect(currentTick(world.grids[1])!.supplyW).toBe(recorded.supplyW);
  expect(currentTick(world.grids[1])!.expensesImports).toBe(
    recorded.expensesImports,
  );
});
test("shared upgrade needs both owners, charges once, and never changes capacity on disconnect", () => {
  const world = create(2),
    edge = world.edges[0],
    initial = edge.capacityW;
  const cash = world.grids.map((g) => currentTick(g)!.cash);
  command(world, 0, {
    kind: "action",
    name: "upgradeTransmissionLine",
    payload: { corridorId: `peer:${edge.id}`, financed: false },
  });
  expect(world.grids[0].transmission!.lines[0].upgrade).toBeUndefined();
  command(world, 1, {
    kind: "action",
    name: "upgradeTransmissionLine",
    payload: { corridorId: `peer:${edge.id}`, financed: false },
  });
  expect(world.grids[0].transmission!.lines[0].upgrade?.targetCapacityW).toBe(
    initial * 1.5,
  );
  world.grids.forEach((g, i) =>
    expect(currentTick(g)!.cash).toBeLessThan(cash[i]),
  );
  expect(edge.capacityW).toBe(initial);
  expect(
    command(world, 0, {
      kind: "action",
      name: "upgradeTransmissionLine",
      payload: { corridorId: `peer:${edge.id}`, financed: false },
    }),
  ).toMatch(/already upgrading/);
  const saved = checkpointWorld(world);
  expect(
    restoreWorld(saved, "upgrading").grids.map((g) => g.transmission),
  ).toEqual(world.grids.map((g) => g.transmission));
});

test("the normal catalog supports storage and host prices override forged client quotes", () => {
  const world = create(2);
  const before = currentTick(world.grids[0])!.cash;
  expect(
    command(world, 0, {
      kind: "action",
      name: "buildFacility",
      payload: {
        facility: {
          name: "Wind",
          peakW: 50e6,
          buildCost: 0,
          annualOperatingCost: 0,
        },
        financed: false,
      },
    }),
  ).toBeUndefined();
  expect(currentTick(world.grids[0])!.cash).toBeLessThan(before);
  expect(world.grids[0].facilities.at(-1)!.buildCost).toBeGreaterThan(0);
  expect(
    command(world, 0, {
      kind: "action",
      name: "buildFacility",
      payload: { facility: { name: "Battery", peakWh: 50e6 }, financed: true },
    }),
  ).toBeUndefined();
  expect(world.grids[0].facilities.at(-1)!.peakWh).toBe(50e6);
  expect(
    command(world, 0, {
      kind: "action",
      name: "setTradingPolicy",
      payload: "CLOSED",
    }),
  ).toBeUndefined();
  expect(world.grids[0].transmission!.tradingPolicy).toBe("CLOSED");
  expect(
    command(world, 0, {
      kind: "action",
      name: "delta",
      payload: { cash: 1e12 },
    }),
  ).toMatch(/unavailable/);
  expect(
    command(world, 0, { kind: "action", name: "buildFacility", payload: null }),
  ).toMatch(/unavailable/);
  expect(
    command(world, 0, {
      kind: "action",
      name: "buildFacility",
      payload: {
        facility: {
          name: "Wind",
          peakW: 50e6,
          resilience: { designMinTempC: -1e9 },
        },
        financed: true,
      },
    }),
  ).toMatch(/valid facility options/);
});

test("shared saves reject changed peer routes and duplicate connections", () => {
  const world = create(3);
  const badRoute = checkpointWorld(world);
  badRoute.grids[0].multiplayer!.peers![0].corridor.buildCost = 0;
  expect(() => restoreWorld(badRoute, "bad")).toThrow(
    /invalid grids or connections/,
  );
  const duplicate = checkpointWorld(world);
  duplicate.grids[0].transmission!.lines[1] = {
    ...duplicate.grids[0].transmission!.lines[0],
  };
  expect(() => restoreWorld(duplicate, "bad")).toThrow(
    /invalid grids or connections/,
  );
});
test("resume restores the entire match and drops prior-session purchase IDs", () => {
  const world = create(3);
  command(world, 0, {
    kind: "action" as const,
    name: "buildFacility",
    payload: { facility: { name: "Wind", peakW: 50e6 }, financed: true },
  });
  const { stringify, parse } = require("../../electron/steam-multiplayer.cjs");
  const restored = restoreWorld(
    parse(stringify(checkpointWorld(world))),
    "new-epoch",
  );
  expect(restored.paused).toBe(true);
  expect(restored.sequences).toEqual({});
  expect(restored.grids.map((g) => g.facilities)).toEqual(
    world.grids.map((g) => g.facilities),
  );
  expect(
    applyCommand(restored, "0", {
      matchId: "match",
      epoch: "epoch",
      sequence: 2,
      command: {
        kind: "action" as const,
        name: "buildFacility",
        payload: { facility: { name: "Wind", peakW: 50e6 }, financed: true },
      },
    }),
  ).toMatch(/another session/);
  expect(() =>
    restoreWorld({ ...world, grids: world.grids.slice(1) }, "new"),
  ).toThrow(/incomplete/);
  expect(() => restoreWorld({ ...world, rules: "other-build" }, "new")).toThrow(
    /original game build/,
  );
  const before = world.grids[0].date.minute;
  world.seats.forEach((_seat, i) => {
    command(world, i, { kind: "ready" });
    command(restored, i, { kind: "ready" });
  });
  for (let i = 0; i < 100; i++) {
    stepWorld(world);
    stepWorld(restored);
  }
  expect(restored.grids[0].date.minute).toBeGreaterThan(before);
  expect(restored.grids.map((g) => currentTick(g)?.cash)).toEqual(
    world.grids.map((g) => currentTick(g)?.cash),
  );
});
test("rejected commands retain their receipt when the same ID is retried", () => {
  const world = create(2);
  const envelope = {
    matchId: "match",
    epoch: "epoch",
    sequence: 1,
    command: {
      kind: "action" as const,
      name: "buildFacility",
      payload: {
        facility: { name: "Invented plant", peakW: 50e6 },
        financed: true,
      },
    },
  };
  const error = applyCommand(world, "0", envelope);
  expect(error).toMatch(/unavailable/);
  expect(applyCommand(world, "0", envelope)).toBe(error);
  expect(roomView(world, "0").receipt).toEqual({ sequence: 1, error });
});
test("a readiness command arriving during a disconnect is rejected and acknowledged", () => {
  const world = create(2);
  expect(
    applyCommand(
      world,
      "0",
      {
        matchId: "match",
        epoch: "epoch",
        sequence: 1,
        command: { kind: "ready" },
      },
      false,
    ),
  ).toMatch(/reconnect/);
  expect(world.ready).toEqual([]);
  expect(roomView(world, "0").receipt?.sequence).toBe(1);
  expect(command(world, 0, { kind: "ready" })).toBeUndefined();
});

test("identical companies trade once one of them runs short", () => {
  const world = create(4);
  const gas = world.grids[0].facilities.find((f) => f.fuel === "Natural Gas")!;
  expect(
    command(world, 0, {
      kind: "action",
      name: "togglePauseFacility",
      payload: gas.id,
    }),
  ).toBeUndefined();
  world.seats.forEach((_seat, i) => command(world, i, { kind: "ready" }));
  let traded = false;
  for (let tick = 0; tick < 1152; tick++) {
    stepWorld(world);
    traded ||= world.edges.some((e) => Math.abs(e.flowW) > 1);
  }
  expect(traded).toBe(true);
});

test("the slowest player's selection sets the shared speed without changing anyone else's controls", () => {
  const world = create(3);
  world.seats.forEach((_s, i) => command(world, i, { kind: "ready" }));
  command(world, 0, { kind: "speed", speed: "ULTRA" });
  command(world, 1, { kind: "speed", speed: "NORMAL" });
  command(world, 2, { kind: "speed", speed: "SLOW" });
  expect(world.speed).toBe("SLOW");
  expect(roomView(world, "0").grids.map((g) => g.selectedSpeed)).toEqual([
    "ULTRA",
    "NORMAL",
    "SLOW",
  ]);
  command(world, 2, { kind: "speed", speed: "FAST" });
  expect(world.speed).toBe("NORMAL");
  command(world, 1, { kind: "speed", speed: "ULTRA" });
  expect(world.speed).toBe("FAST");
  command(world, 2, { kind: "speed", speed: "ULTRA" });
  expect(world.speed).toBe("ULTRA");
  command(world, 1, { kind: "speed", speed: "PAUSED" });
  const minute = world.grids[0].date.minute;
  stepWorld(world);
  expect(world.grids.every((g) => g.date.minute === minute)).toBe(true);
  expect(world.readyRequired).toBe(false);
  command(world, 0, { kind: "ready" });
  command(world, 2, { kind: "speed", speed: "SLOW" });
  expect(world.speed).toBe("PAUSED");
  command(world, 1, { kind: "speed", speed: "ULTRA" });
  expect(world.speed).toBe("SLOW");
});

test("menus and notifications pause every grid and only resume when every player is unblocked", () => {
  const world = create(3);
  world.seats.forEach((_s, i) => command(world, i, { kind: "ready" }));
  command(world, 0, { kind: "speed", speed: "ULTRA" });
  command(world, 1, { kind: "activity", reason: "Building power plants" });
  command(world, 2, { kind: "activity", reason: "Reading notification" });
  expect(world.speed).toBe("PAUSED");
  expect(roomView(world, "0").grids[1]).toMatchObject({
    selectedSpeed: "NORMAL",
    pauseReason: "Building power plants",
  });
  const minute = world.grids[0].date.minute;
  stepWorld(world);
  expect(world.grids.every((g) => g.date.minute === minute)).toBe(true);
  command(world, 1, { kind: "activity", reason: null });
  expect(world.speed).toBe("PAUSED");
  expect(world.reason).toContain("Reading notification");
  command(world, 2, { kind: "activity", reason: null });
  expect(world.speed).toBe("NORMAL");
  expect(world.selectedSpeeds["0"]).toBe("ULTRA");
  stepWorld(world);
  expect(world.grids.every((g) => g.date.minute > minute)).toBe(true);
  command(world, 1, { kind: "pause" });
  command(world, 1, { kind: "activity", reason: "Building power plants" });
  command(world, 1, { kind: "activity", reason: null });
  expect(world.speed).toBe("PAUSED");
});

test("safety stops require every player's running-speed consent and menu changes cannot consent", () => {
  const world = create(2);
  command(world, 0, { kind: "speed", speed: "ULTRA" });
  command(world, 1, { kind: "speed", speed: "ULTRA" });
  expect(world.speed).toBe("ULTRA");
  pauseWorld(world, "Player disconnected");
  command(world, 0, { kind: "speed", speed: "SLOW" });
  command(world, 1, { kind: "activity", reason: null });
  expect(world.speed).toBe("PAUSED");
  expect(world.reason).toBe("Player disconnected");
  command(world, 0, { kind: "ready" });
  expect(world.speed).toBe("PAUSED");
  command(world, 1, { kind: "ready" });
  expect(world.speed).toBe("SLOW");
});

test("invalid speeds and activity payloads cannot corrupt the shared clock", () => {
  const world = create(2);
  for (const action of [
    { kind: "speed", speed: "INVALID" },
    { kind: "speed", speed: "toString" },
    { kind: "activity", reason: 123 },
    { kind: "activity", reason: " " },
    { kind: "activity", reason: "x".repeat(121) },
  ])
    expect(command(world, 0, action as Command)).toMatch(/valid/i);
  expect(world.selectedSpeeds["0"]).toBe("NORMAL");
  expect(world.activities).toEqual({});
});

test("saved matches preserve individual selections but clear stale menus on restore", () => {
  const world = create(2);
  command(world, 0, { kind: "speed", speed: "ULTRA" });
  command(world, 1, { kind: "speed", speed: "SLOW" });
  command(world, 0, { kind: "activity", reason: "Leaving match" });
  const saved = checkpointWorld(world);
  const restored = restoreWorld(saved, "new-epoch");
  expect(restored.selectedSpeeds).toEqual(world.selectedSpeeds);
  expect(restored.activities).toEqual({});
  expect(restored.readyRequired).toBe(true);
  expect(restored.speed).toBe("PAUSED");
  restored.seats.forEach((_s, i) => command(restored, i, { kind: "ready" }));
  expect(restored.speed).toBe("SLOW");
  expect(() =>
    restoreWorld(
      { ...saved, selectedSpeeds: { 0: "INVALID", 1: "SLOW" } },
      "new",
    ),
  ).toThrow(/invalid player speeds/);
  expect(() =>
    restoreWorld({ ...saved, activities: { outsider: "Building" } }, "new"),
  ).toThrow(/invalid player speeds/);
});

test("co-op forecasts charge storage from surplus like any grid", () => {
  const world = create(2);
  expect(
    command(world, 0, {
      kind: "action",
      name: "buildFacility",
      payload: { facility: { name: "Battery", peakWh: 50e6 }, financed: false },
    }),
  ).toBeUndefined();
  const battery = world.grids[0].facilities.at(-1)!;
  battery.yearsToBuildLeft = 0;
  battery.currentWh = 0;
  // A trading rule change reforecasts the rest of the month as a simulated pass.
  for (const policy of ["SURPLUS_ONLY", "BALANCED"])
    expect(
      command(world, 0, {
        kind: "action",
        name: "setTradingPolicy",
        payload: policy,
      }),
    ).toBeUndefined();
  const grid = world.grids[0];
  const forecast = grid.timeline.filter((t) => t.minute > grid.date.minute);
  expect(forecast.some((t) => (t.storageChargeW || 0) > 0)).toBe(true);
  expect(forecast.at(-1)!.storedWh).toBeGreaterThan(0);
});

test("only the other owner is asked to approve a requested link upgrade", () => {
  const world = create(2);
  command(world, 0, {
    kind: "action",
    name: "upgradeTransmissionLine",
    payload: { corridorId: `peer:${world.edges[0].id}`, financed: false },
  });
  const peer = (seat: string) =>
    roomView(world, seat).game!.multiplayer!.peers![0];
  expect(peer("0")).toMatchObject({
    upgradeRequestedBy: "Player 0",
    upgradeRequestedBySelf: true,
  });
  expect(peer("1")).toMatchObject({
    upgradeRequestedBy: "Player 0",
    upgradeRequestedBySelf: false,
  });
});

test("every difficulty can be chosen and mirrored for a co-op game", () => {
  for (const difficulty of DIFFICULTY_IDS) {
    expect(() =>
      matchScenario({ ...COOP_TEST_SPEC, difficulty }),
    ).not.toThrow();
    expect(
      validBrowseState({
        session: "s",
        revision: 1,
        phase: "browsing",
        card: "NEW_GAME_DETAILS",
        scenarioId: 107,
        difficulty,
      }),
    ).toBe(true);
  }
});
