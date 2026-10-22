import "../Store";
import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import cloneDeep from "lodash.clonedeep";
import { SAVE_SCHEMA_VERSION } from "../SaveUpgrade";
import { TICKS_PER_MONTH } from "../Constants";
import { GENERATORS } from "../data/Facilities";
import { getScenario } from "../data/Scenarios";
import { accessContextForGame } from "../data/IntertieAccess";
import { currentTick } from "../helpers/GameSelectors";
import { getScenarioLocation } from "../helpers/Locations";
import { gameObjectiveResults } from "../helpers/ObjectiveRules";
import { scenarioRules } from "../helpers/ScenarioRules";
import { checkMonth, InvariantCollector } from "../testing/Invariants";
import { coopSeats } from "../testing/MultiplayerFixtures";
import { loadSimData } from "../testing/SimData";
import type { Command, World } from "./Types";
import {
  applyCommand,
  checkpointWorld,
  createWorld,
  restoreWorld,
  stepWorld,
} from "./World";
const codec = require("../../electron/steam-multiplayer.cjs");

jest.setTimeout(120000);
const command = (world: World, seat: string, action: Command) => {
  const error = applyCommand(world, seat, {
    matchId: world.matchId,
    epoch: world.epoch,
    sequence: (world.sequences[seat] ?? 0) + 1,
    command: action,
  });
  expect(error).toBeUndefined();
};
function advance(world: World, month: number) {
  for (
    let tick = 0;
    world.grids[0].date.monthsElapsed < month &&
    tick < (month + 1) * TICKS_PER_MONTH;
    tick++
  )
    stepWorld(world);
  expect(world.grids.map((game) => game.date.monthsElapsed)).toEqual([
    month,
    month,
  ]);
}

/** Same reproducible UI-legal strategy can be executed by an independent old-owner capture. */
export function playLoadSheddingWorld() {
  loadSimData(getScenarioLocation(getScenario(113))!);
  const world = createWorld(
    { scenarioId: 113, difficulty: "Employee" },
    coopSeats(2),
    "load-shedding-official-pilot",
    "initial",
  );
  const initial = cloneDeep(world);
  for (const [index, seat] of world.seats.entries()) {
    const game = world.grids[index];
    const facility = GENERATORS(
      game,
      500e6,
      game.timeline.map((tick) => tick.windKph),
      game.timeline.map((tick) => tick.solarIrradianceWM2),
    ).find((quote) => quote.name === "Natural Gas Peaker" && quote.available)!;
    expect(facility).toBeDefined();
    command(world, seat.id, {
      kind: "action",
      name: "buildFacility",
      payload: { facility, financed: true },
    });
    command(world, seat.id, { kind: "rate", value: 0.12 });
    expect(world.grids[index].facilities).toContainEqual(
      expect.objectContaining({ name: "Natural Gas Peaker", peakW: 500e6 }),
    );
  }
  for (const seat of world.seats) command(world, seat.id, { kind: "ready" });
  const reached: {
    month: number;
    occurrences: World["grids"][number]["worldEvents"]["occurrences"][];
    active: string[][];
    activeFacts: World["grids"][number]["worldEvents"]["active"][];
  }[] = [];
  let resumed: World | undefined;
  for (const month of [30, 36, 48, 60, 72, 84]) {
    advance(world, month);
    reached.push({
      month,
      occurrences: cloneDeep(
        world.grids.map((game) => game.worldEvents.occurrences),
      ),
      active: world.grids.map((game) =>
        game.worldEvents.active.map((event) => event.key),
      ),
      activeFacts: cloneDeep(
        world.grids.map((game) => game.worldEvents.active),
      ),
    });
    if (month === 36) {
      resumed = restoreWorld(
        codec.parse(codec.stringify(checkpointWorld(world))),
        "restored",
      );
      for (const seat of resumed.seats)
        command(resumed, seat.id, { kind: "ready" });
    } else if (resumed) advance(resumed, month);
  }
  return { initial, world, resumed: resumed!, reached };
}

/** Every field participates; numeric precision matches the independent solo golden evidence. */
function canonical(value: unknown): unknown {
  if (typeof value === "number")
    return Number.isFinite(value)
      ? value === 0
        ? 0
        : Number(value.toPrecision(10))
      : String(value);
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  return value;
}
const digest = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");

/** Bounded review facts plus complete state hashes; only the outer source fingerprint differs. */
export function loadSheddingWorldEvidence(
  result: ReturnType<typeof playLoadSheddingWorld>,
) {
  const { rules: _initialRules, ...initial } = result.initial;
  const { rules: _finalRules, ...world } = result.world;
  expect(SAVE_SCHEMA_VERSION).toBe(6);
  expect(initial.gameSchema).toBe(SAVE_SCHEMA_VERSION);
  expect(world.gameSchema).toBe(SAVE_SCHEMA_VERSION);
  // The source capture used native save schema3. Keep every other World field.
  initial.gameSchema = 3;
  world.gameSchema = 3;
  return canonical({
    initialWorldHash: digest(initial),
    finalWorldHash: digest(world),
    spec: world.spec,
    matchId: world.matchId,
    seats: world.seats,
    initialCompanies: initial.grids.map((game, index) => ({
      seat: initial.seats[index].id,
      scenarioId: game.scenarioId,
      hasCustomScenario: game.customScenario !== undefined,
      hasRunIdentity: game.runIdentity !== undefined,
      seed: game.seed,
      difficulty: game.difficulty,
      location: game.location,
      startingYear: game.startingYear,
      startingDemandScale: game.startingDemandScale,
      loadAdditions: game.loadAdditions,
      customerMarketSize: game.customerMarketSize,
      customers: currentTick(game)!.customers,
      dollarsPerkWh: game.dollarsPerkWh,
      cash: currentTick(game)!.cash,
      facilitiesHash: digest(game.facilities),
      completeGameHash: digest(game),
    })),
    companies: world.grids.map((game, index) => ({
      seat: world.seats[index].id,
      scenarioId: game.scenarioId,
      seed: game.seed,
      months: game.monthlyHistory.length,
      monthlyHistoryHash: digest(game.monthlyHistory),
      finalFacilitiesHash: digest(game.facilities),
      completeGameHash: digest(game),
      objectiveProgress: game.objectiveProgress,
      objectiveResults: gameObjectiveResults(game),
      worldEvents: game.worldEvents,
    })),
    reached: result.reached,
    outcomes: world.outcomes,
  });
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

test("two real official companies reach every Load Shedding step and final window with exact checkpoint continuation", () => {
  const { world, resumed, reached } = playLoadSheddingWorld();
  expect(world.spec).toEqual({ scenarioId: 113, difficulty: "Employee" });
  expect(reached.map((point) => point.month)).toEqual([30, 36, 48, 60, 72, 84]);
  const declared = [
    "maintenance-backlog",
    "availability-step-1",
    "availability-step-2",
    "availability-step-3",
    "availability-step-4",
  ].map((id) => `story:113:load-shedding:${id}`);
  for (const [index, seat] of world.seats.entries()) {
    const game = world.grids[index];
    expect(game.scenarioId).toBe(113);
    expect(game.customScenario).toBeUndefined();
    expect(game.runIdentity).toBeUndefined(); // Co-op companies have always been unranked.
    expect(accessContextForGame(game).scenarioId).toBe(113);
    expect(scenarioRules(getScenario(113), game)!.namespace.kind).toBe(
      "official",
    );
    expect(scenarioRules(getScenario(113), game)!.seed).toBe(game.seed);
    expect(game.monthlyHistory).toHaveLength(84);
    expect(
      game.worldEvents.occurrences
        .filter((event) => declared.includes(event.key))
        .map((event) => event.key),
    ).toEqual(declared);
    expect(
      game.worldEvents.active.some((event) => declared.includes(event.key)),
    ).toBe(false);
    expect(gameObjectiveResults(game)).toContainEqual(
      expect.objectContaining({
        id: "reliability",
        observedMonths: 12,
        requiredMonths: 12,
        status: "completed",
      }),
    );
    expect(world.outcomes[seat.id].outcome).toBe("completed");
    const violations = new InvariantCollector();
    for (const month of game.monthlyHistory)
      checkMonth(violations, month, `${month.year}-${month.month}`);
    expect(violations.getViolations()).toEqual([]);
    const restored = resumed.grids[index];
    expect(restored.monthlyHistory).toEqual(game.monthlyHistory);
    expect(restored.facilities).toEqual(game.facilities);
    expect(restored.worldEvents).toEqual(game.worldEvents);
    expect(restored.objectiveProgress).toEqual(game.objectiveProgress);
    expect(currentTick(restored)).toEqual(currentTick(game));
  }
  expect(resumed.outcomes).toEqual(world.outcomes);
  for (const [index, point] of reached.slice(1, 5).entries()) {
    for (const active of point.active)
      expect(active).toContain(declared[index + 1]);
  }
});

test("two real official companies preserve the independent pre-migration World evidence", () => {
  const reference = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "../testing/fixtures/LoadSheddingLegacyWorld.json"),
      "utf8",
    ),
  );
  expect(reference.baselineCommit).toBe(
    "2fc5d50ebedd5d3695b9db7d75ca5b54c0912779",
  );
  expect(reference.significantDigits).toBe(10);
  expect(loadSheddingWorldEvidence(playLoadSheddingWorld())).toEqual(
    reference.evidence,
  );
});
