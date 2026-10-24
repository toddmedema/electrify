import "../Store";
import cloneDeep from "lodash.clonedeep";
import { TICKS_PER_MONTH } from "../Constants";
import type { RuleObjective } from "../data/ScenarioRules";
import { getScenarioLocation } from "../helpers/Locations";
import { currentTick } from "../helpers/GameSelectors";
import { gameObjectiveResults } from "../helpers/ObjectiveRules";
import { pendingScenarioChoice } from "../helpers/ScenarioChoices";
import { modRuntimeDigest, validScenarioMod } from "../helpers/ScenarioMod";
import { modScenario } from "../mods/ModScenario";
import type { ModPackage } from "../mods/ModSchema";
import { coopSeats } from "../testing/MultiplayerFixtures";
import { loadSimData } from "../testing/SimData";
import type { Command, MatchSpec, World } from "./Types";
import {
  applyCommand,
  checkpointWorld,
  createWorld,
  matchScenario,
  restoreWorld,
  roomView,
  savedMatchSpec,
  stepWorld,
} from "./World";

function pack(objectives: RuleObjective[] = []): ModPackage {
  return {
    schemaVersion: 1,
    gameApi: 1,
    id: "coop-decisions",
    title: "Shared rules, separate companies",
    creator: "Fixture",
    version: "1",
    description: "Choose funding for your grid, then serve your customers.",
    seed: 42,
    baseScenarioId: 999,
    officialArcs: [],
    scenario: {
      durationMonths: 6,
      startingYear: 2020,
      cash: 1e9,
      startingCustomers: 10000,
      dollarsPerkWh: 0.2,
    },
    objectives: objectives,
    choices: [
      {
        id: "funding",
        title: "Fund your grid",
        prompt: "Accept company funding or keep your current plan.",
        dueMonth: 1,
        options: [
          {
            id: "accept",
            label: "Accept funding",
            description: "Receive a grant for your grid.",
            message: "Your company received its funding.",
            grantDollars: 1000000,
          },
          {
            id: "repair",
            label: "Repair your grid",
            description: "Pay for company repairs.",
            message: "Your company paid for repairs.",
            costDollars: 1000,
          },
          {
            id: "decline",
            label: "Keep the plan",
            description: "Keep your plan without funding.",
            message: "Your company kept its plan.",
            costDollars: 0,
          },
        ],
      },
    ],
    events: [
      {
        id: "opening-support",
        title: "Grid support",
        message: "Operating costs fall for your grid.",
        startMonth: 1,
        durationMonths: 2,
        preview: "Operating costs will fall for your grid.",
        effects: { operatingCostMultipliersByFuel: { "Natural Gas": 0.9 } },
      },
    ],
  };
}
function spec(objectives: RuleObjective[] = []): MatchSpec {
  return {
    scenarioId: 999,
    difficulty: "Employee",
    customScenario: modScenario(pack(objectives), undefined, "Employee"),
  };
}
const command = (world: World, player: number, action: Command) =>
  applyCommand(world, String(player), {
    matchId: world.matchId,
    epoch: world.epoch,
    sequence: (world.sequences[String(player)] ?? 0) + 1,
    command: action,
  });
const answer = (optionId: string): Command => ({
  kind: "action",
  name: "chooseScenarioResponse",
  payload: { decisionId: "mod:coop-decisions:funding", optionId },
});
function world(objectives: RuleObjective[] = []) {
  const selected = spec(objectives);
  const location = getScenarioLocation(selected.customScenario);
  if (!location)
    throw new Error("The fixture must resolve its bundled location");
  loadSimData(location);
  return createWorld(selected, coopSeats(2), "mod-match", "epoch");
}
function release(world: World) {
  world.seats.forEach((_seat, i) => {
    expect(command(world, i, { kind: "ready" })).toBeUndefined();
  });
}

beforeAll(() => loadSimData("SF"));
beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

test("a valid mod creates detached identical company snapshots with no official identity", () => {
  const selected = spec();
  expect(
    validScenarioMod(selected.customScenario!.mod, selected.customScenario),
  ).toBe(true);
  expect(matchScenario(selected).scenario).toEqual(selected.customScenario);
  const created = createWorld(selected, coopSeats(2), "mod-match", "epoch");
  expect(created.spec).toEqual(selected);
  expect(created.spec).not.toBe(selected);
  created.grids.forEach((grid) => {
    expect(grid.scenarioId).toBe(999);
    expect(grid.seed).toBe(42);
    expect(grid.difficulty).toBe("Employee");
    expect(grid.customScenario).toEqual(selected.customScenario);
    expect(grid.customScenario).not.toBe(selected.customScenario);
    expect(grid.runIdentity).toBeUndefined();
    expect(grid.desktopAchievements).toBeUndefined();
    expect(grid.worldEvents.active.map((event) => event.key)).toContain(
      "mod:coop-decisions:opening-support",
    );
    expect(grid.facilities).toEqual(created.grids[0].facilities);
  });
  // Starting a match neither freezes nor subsequently consults the caller's library entry.
  selected.customScenario!.name = "An updated library entry";
  expect(created.spec.customScenario!.name).toBe(
    "Shared rules, separate companies",
  );
});

test("each company answers its own choice before the shared clock advances; grants book exactly once", () => {
  const created = world();
  release(created);
  expect(created.paused).toBe(true);
  expect(created.grids.map((grid) => pendingScenarioChoice(grid)?.id)).toEqual([
    "mod:coop-decisions:funding",
    "mod:coop-decisions:funding",
  ]);
  expect(created.reason).toContain("Player 0: Choosing a response");
  expect(created.reason).toContain("Player 1: Choosing a response");
  const accounting = cloneDeep(currentTick(created.grids[0])!);
  const before = created.grids.map((grid) => currentTick(grid)!.cash);
  stepWorld(created);
  expect(created.grids.map((grid) => grid.date.minute)).toEqual([0, 0]);
  expect(command(created, 0, answer("accept"))).toBeUndefined();
  expect(currentTick(created.grids[0])!.cash - before[0]).toBe(1000000);
  expect(currentTick(created.grids[0])!.revenueGrants).toBe(1000000);
  expect(currentTick(created.grids[0])!.revenue).toBe(
    accounting.revenue + 1000000,
  );
  expect(currentTick(created.grids[0])!.expensesOM).toBe(accounting.expensesOM);
  expect(currentTick(created.grids[1])!.cash).toBe(before[1]);
  expect(created.paused).toBe(true);
  expect(created.reason).not.toContain("Player 0: Choosing");
  expect(created.reason).toContain("Player 1: Choosing a response");
  expect(roomView(created, "0").game!.multiplayer!.clock!.players).toEqual([
    expect.objectContaining({ name: "Player 0", pauseReason: undefined }),
    expect.objectContaining({
      name: "Player 1",
      pauseReason: "Choosing a response",
    }),
  ]);
  // A retried semantic response with a new command sequence cannot pay again.
  expect(command(created, 0, answer("accept"))).toBeUndefined();
  expect(currentTick(created.grids[0])!.cash).toBe(before[0] + 1000000);
  expect(command(created, 1, answer("decline"))).toBeUndefined();
  expect(currentTick(created.grids[1])!.cash).toBe(before[1]);
  expect(created.paused).toBe(false);
  stepWorld(created);
  expect(created.grids.map((grid) => grid.date.minute)).toEqual([15, 15]);
  expect(
    created.grids[0].worldEvents.occurrences.find(
      (event) => event.key === "mod:coop-decisions:funding",
    )!.attributes.choice,
  ).toBe("accept");
  expect(
    created.grids[1].worldEvents.occurrences.find(
      (event) => event.key === "mod:coop-decisions:funding",
    )!.attributes.choice,
  ).toBe("decline");
});

test("a pending choice names each deciding company ahead of generic reading activity", () => {
  const created = world();
  release(created);
  created.seats.forEach((_seat, index) => {
    expect(
      command(created, index, {
        kind: "activity",
        reason: "Reading notification",
      }),
    ).toBeUndefined();
  });
  const players = () =>
    roomView(created, "0").game!.multiplayer!.clock!.players;
  expect(players()).toEqual([
    expect.objectContaining({
      name: "Player 0",
      pauseReason: "Choosing a response",
    }),
    expect.objectContaining({
      name: "Player 1",
      pauseReason: "Choosing a response",
    }),
  ]);
  expect(created.activities).toEqual({
    0: "Reading notification",
    1: "Reading notification",
  });
  expect(command(created, 0, answer("accept"))).toBeUndefined();
  expect(players()).toEqual([
    expect.objectContaining({
      name: "Player 0",
      pauseReason: "Reading notification",
    }),
    expect.objectContaining({
      name: "Player 1",
      pauseReason: "Choosing a response",
    }),
  ]);
  expect(command(created, 1, answer("decline"))).toBeUndefined();
  expect(players().map((player) => player.pauseReason)).toEqual([
    "Reading notification",
    "Reading notification",
  ]);
});

test("a response charge remains company expense without replacing settled energy or sales", () => {
  const created = world();
  release(created);
  const before = cloneDeep(currentTick(created.grids[0])!);
  expect(command(created, 0, answer("repair"))).toBeUndefined();
  const after = currentTick(created.grids[0])!;
  expect(after.cash).toBe(before.cash - 1000);
  expect(after.expensesOM).toBe(before.expensesOM + 1000);
  expect(after.revenue).toBe(before.revenue);
  expect(after.revenueGrants).toBe(before.revenueGrants ?? 0);
  expect(after.demandW).toBe(before.demandW);
  expect(after.supplyW).toBe(before.supplyW);
  expect(after.importedW).toBe(before.importedW);
  expect(after.exportedW).toBe(before.exportedW);
  expect(currentTick(created.grids[1])!.expensesOM).toBe(before.expensesOM);
  expect(command(created, 0, answer("repair"))).toBeUndefined();
  expect(currentTick(created.grids[0])!.expensesOM).toBe(after.expensesOM);
});

test.each([
  [
    "resolved difficulty",
    (selected: MatchSpec) => {
      selected.difficulty = "CEO";
    },
  ],
  [
    "changed setup",
    (selected: MatchSpec) => {
      selected.customScenario!.cash += 1;
    },
  ],
  [
    "forged official identity",
    (selected: MatchSpec) => {
      selected.customScenario!.id = 100;
    },
  ],
  [
    "mismatched digest",
    (selected: MatchSpec) => {
      selected.customScenario!.mod!.runtimeDigest = `sha256-${"0".repeat(64)}`;
    },
  ],
  [
    "unsafe rehashed text",
    (selected: MatchSpec) => {
      const mod = selected.customScenario!.mod!;
      mod.source.description = "<img src=x onerror=alert(1)>";
      mod.runtimeDigest = modRuntimeDigest(mod);
    },
  ],
  [
    "oversized snapshot",
    (selected: MatchSpec) => {
      selected.customScenario!.mod!.source.description = "x".repeat(
        512 * 1024 + 1,
      );
    },
  ],
] as const)(
  "world creation rejects %s without mutating a valid neighboring selection",
  (_name, mutate) => {
    const selected = spec();
    const before = JSON.stringify(selected);
    const invalid = cloneDeep(selected);
    mutate(invalid);
    expect(() =>
      createWorld(invalid, coopSeats(2), "mod-match", "epoch"),
    ).toThrow();
    expect(JSON.stringify(selected)).toBe(before);
    expect(() =>
      createWorld(selected, coopSeats(2), "mod-match", "epoch"),
    ).not.toThrow();
  },
);

test("a company's objective failure retires only its grid and the result carries the common verdict", () => {
  const created = world([
    {
      id: "affordable",
      label: "Keep bills affordable",
      metric: "monthlyBilledRate",
      fromMonth: 1,
      throughMonth: 6,
      maxDollarsPerKWh: 0.1,
    },
  ]);
  release(created);
  command(created, 0, answer("accept"));
  command(created, 1, answer("decline"));
  expect(command(created, 0, { kind: "rate", value: 0.05 })).toBeUndefined();
  for (
    let tick = 0;
    tick < TICKS_PER_MONTH * 2 && !created.outcomes["1"];
    tick++
  )
    stepWorld(created);
  expect(created.outcomes["0"]).toBeUndefined();
  expect(created.outcomes["1"]).toMatchObject({ outcome: "fired", month: 1 });
  expect(gameObjectiveResults(created.grids[0])[0].status).toBe("inProgress");
  expect(gameObjectiveResults(created.grids[1])[0].status).toBe("failed");
  const results = roomView(created, "0").game!.multiplayer!.results!;
  expect(results).toEqual([
    expect.objectContaining({
      id: "1",
      outcome: "fired",
      objectiveResults: gameObjectiveResults(created.grids[1]),
    }),
  ]);
  const frozen = created.grids[1].date.minute;
  for (let tick = 0; tick < 2; tick++) stepWorld(created);
  expect(created.grids[1].date.minute).toBe(frozen);
  expect(created.grids[0].date.minute).toBeGreaterThan(frozen);
  expect(
    created.grids.every(
      (grid) =>
        grid.runIdentity === undefined &&
        grid.desktopAchievements === undefined,
    ),
  ).toBe(true);
});

test("pending and answered per-company choices survive an atomic world checkpoint", () => {
  const created = world();
  release(created);
  command(created, 0, answer("accept"));
  const saved = JSON.parse(JSON.stringify(checkpointWorld(created)));
  const restored = restoreWorld(saved, "restored");
  expect(restored.grids.map((grid) => pendingScenarioChoice(grid)?.id)).toEqual(
    [undefined, "mod:coop-decisions:funding"],
  );
  const cash = restored.grids.map((grid) => currentTick(grid)!.cash);
  release(restored);
  command(restored, 0, answer("accept"));
  expect(currentTick(restored.grids[0])!.cash).toBe(cash[0]);
  expect(restored.paused).toBe(true);
  command(restored, 1, answer("decline"));
  expect(restored.paused).toBe(false);
  stepWorld(restored);
  expect(restored.grids.map((grid) => grid.date.minute)).toEqual([15, 15]);
  const altered = cloneDeep(saved);
  altered.spec.customScenario.mod.runtimeDigest = `sha256-${"0".repeat(64)}`;
  expect(() => restoreWorld(altered, "rejected")).toThrow();
  expect(() => restoreWorld(saved, "valid-again")).not.toThrow();
});

test("the save envelope validates its mod selection before choosing scenario data to load", () => {
  const saved = JSON.parse(JSON.stringify(checkpointWorld(world())));
  expect(savedMatchSpec(saved)).toEqual(saved.spec);
  const invalid = cloneDeep(saved);
  invalid.spec.difficulty = "CEO";
  expect(() => savedMatchSpec(invalid)).toThrow();
  expect(() => savedMatchSpec({ ...saved, schema: 4 })).toThrow(
    /unsupported format/,
  );
  expect(savedMatchSpec(saved)).toEqual(saved.spec);
});

test("same-opening conditional transfers and loads preserve bill measurements on the receiving company", () => {
  const input = pack([
    {
      id: "normal-bills",
      label: "Keep ordinary bills",
      metric: "monthlyBilledRate",
      fromMonth: 1,
      throughMonth: 6,
      maxDollarsPerKWh: 0.21,
    },
  ]);
  input.events!.push({
    id: "conditional-funding",
    title: "Connection support",
    message: "Your grid receives support and pays the connection charge.",
    preview: "Your grid will receive connection support if you accept.",
    startMonth: 1,
    durationMonths: 1,
    requiresChoice: { choiceId: "funding", optionIds: ["accept"] },
    effects: {
      transactions: [
        { kind: "grant", amountDollars: 20000 },
        { kind: "charge", amountDollars: 5000 },
      ],
    },
    loads: [
      {
        id: "connection",
        startMonth: 1,
        demandType: "Data Centers",
        peakMW: 1,
        loadFactor: 0.9,
      },
    ],
  });
  const selected: MatchSpec = {
    scenarioId: 999,
    difficulty: "Employee",
    customScenario: modScenario(input, undefined, "Employee"),
  };
  const created = createWorld(selected, coopSeats(2), "conditional", "epoch");
  release(created);
  const before = cloneDeep(currentTick(created.grids[0])!);
  const futureDemand = created.grids[0].timeline[1].demandW;
  command(created, 0, answer("accept"));
  command(created, 1, answer("decline"));
  const received = currentTick(created.grids[0])!;
  expect(received.cash).toBe(before.cash + 1000000 + 20000 - 5000);
  expect(received.revenue).toBe(before.revenue + 1000000 + 20000);
  expect(received.revenueGrants).toBe(1020000);
  expect(received.expensesOM).toBe(before.expensesOM + 5000);
  expect(created.grids[0].timeline[1].demandW).toBeGreaterThan(futureDemand);
  expect(created.grids[1].loadAdditions).toHaveLength(0);
  for (
    let tick = 0;
    tick < TICKS_PER_MONTH * 2 && created.grids[0].date.monthsElapsed < 1;
    tick++
  )
    stepWorld(created);
  expect(created.grids.map((grid) => grid.date.monthsElapsed)).toEqual([1, 1]);
  expect(created.grids[0].monthlyHistory[0].revenueGrants).toBe(1020000);
  expect(created.grids[1].monthlyHistory[0].revenueGrants).toBe(0);
  expect(created.outcomes).toEqual({});
  created.grids.forEach((grid) =>
    expect(gameObjectiveResults(grid)[0].status).toBe("inProgress"),
  );
});
