import cloneDeep from "lodash.clonedeep";
import {
  advancePolicies,
  applyPolicyDemand,
  emptyPolicies,
  policyBudget,
} from "./Policies";
import { createGame, createGameFromReplay } from "../testing/Simulator";
import gameReducer, {
  generateNewTimeline,
  tickState,
  setSpeed,
} from "../reducers/Game";
import {
  schedulePolicy,
  cancelPolicy,
  openPolicyDecision,
  closePolicyDecision,
} from "../reducers/GameActions";
import {
  getTimeFromTimeline,
  summarizeTimeline,
  deriveExpandedSummary,
} from "./DateTime";
import { previewPolicy } from "./PolicyPreview";
import { parseSave, serializeSave } from "../SaveGame";
import { decodeReplay, serializeReplay } from "../Replay";
import { TICKS_PER_MONTH } from "../Constants";
import { GameType } from "../Types";

function month(game: GameType) {
  const target = game.date.monthsElapsed + 1;
  while (game.date.monthsElapsed < target) tickState(game);
}
const change = { id: "efficiency", tier: "Small", month: 1 } as const;

test("only the dialog that owns a pause restores its previous speed", () => {
  jest.useFakeTimers();
  let game = {
    ...createGame({ scenarioId: 106 }),
    speed: "SLOW" as const,
  } as GameType;
  game = gameReducer(game, openPolicyDecision("one"));
  expect(game.speed).toBe("PAUSED");
  expect(gameReducer(game, closePolicyDecision("other")).speed).toBe("PAUSED");
  expect(gameReducer(game, closePolicyDecision("one")).speed).toBe("SLOW");
  game = gameReducer(game, setSpeed("NORMAL"));
  expect(gameReducer(game, closePolicyDecision("one")).speed).toBe("NORMAL");
  jest.clearAllTimers();
  jest.useRealTimers();
});

test("forecast resolution cannot multiply monthly spending or mutate live adoption", () => {
  const game = createGame({
    scenarioId: 106,
    initialPrograms: { efficiency: "Large", solar: "Small" },
  });
  const snapshot = cloneDeep(game.policies);
  const now = game.timeline[0];
  const fine = generateNewTimeline(
    game,
    now.cash,
    now.customers,
    TICKS_PER_MONTH * 3,
  );
  const hourly = generateNewTimeline(
    game,
    now.cash,
    now.customers,
    (TICKS_PER_MONTH * 3) / 4,
    60,
  );
  const expense = (timeline: typeof fine) =>
    timeline.reduce((sum, t) => sum + (t.expensesPolicy || 0), 0);
  expect(expense(hourly)).toBeCloseTo(expense(fine));
  expect(game.policies).toEqual(snapshot);
});

test("schedule, replace, cancel and reject stale/no-op edits without recording them", () => {
  let game = createGame({ scenarioId: 106, seed: 4 });
  game = gameReducer(game, schedulePolicy(change));
  expect(game.policies!.programs.efficiency.pending).toEqual({
    tier: "Small",
    month: 1,
  });
  const log = game.replayLog!.length;
  expect(gameReducer(game, schedulePolicy(change)).replayLog).toHaveLength(log);
  expect(
    gameReducer(game, schedulePolicy({ ...change, month: 2 })).replayLog,
  ).toHaveLength(log);
  game = gameReducer(game, schedulePolicy({ ...change, tier: "Large" }));
  expect(
    gameReducer(game, cancelPolicy(change)).policies!.programs.efficiency
      .pending!.tier,
  ).toBe("Large");
  game = gameReducer(game, cancelPolicy({ ...change, tier: "Large" }));
  expect(game.policies!.programs.efficiency.pending).toBeUndefined();
  expect(game.policies!.programs.efficiency.spending).toBe(0);
  const tutorial = createGame({ scenarioId: 0 });
  expect(
    gameReducer(tutorial, schedulePolicy(change)).policies,
  ).toBeUndefined();
  const ended = { ...game, date: { ...game.date, monthsElapsed: 191 } };
  expect(
    gameReducer(ended, schedulePolicy({ ...change, month: 192 })).replayLog,
  ).toEqual(game.replayLog);
  const replay = { ...game, replayPlayback: { actions: [], index: 0 } };
  expect(gameReducer(replay, schedulePolicy(change))).toEqual(replay);
});

test("adoption and actual spending are bounded, idempotent, and stop at saturation", () => {
  const game = createGame({ scenarioId: 106 });
  game.policies = emptyPolicies();
  const program = game.policies.programs.efficiency;
  program.tier = "Large";
  program.adoption = 0.99;
  advancePolicies(game, 1);
  expect(program.adoption).toBe(1);
  expect(program.spending).toBeCloseTo(
    policyBudget(game, "efficiency", "Large", 1) * 0.2,
  );
  const saved = cloneDeep(game.policies);
  advancePolicies(game, 1);
  expect(game.policies).toEqual(saved);
  advancePolicies(game, 2);
  expect(program.spending).toBe(0);
});

test("solar affects only eligible daylight load after efficiency; neutral demand is exact", () => {
  const game = createGame({ scenarioId: 106 });
  const original = cloneDeep(game.timeline[0]);
  const tick = cloneDeep(original);
  applyPolicyDemand(game, tick);
  expect(tick).toEqual(original);
  game.policies = emptyPolicies();
  game.policies.programs.solar.adoption = 1;
  tick.solarIrradianceWM2 = 0;
  applyPolicyDemand(game, tick);
  expect(tick.demandByType).toEqual(original.demandByType);
  game.policies.programs.efficiency.adoption = 1;
  tick.solarIrradianceWM2 = 100000;
  applyPolicyDemand(game, tick);
  expect(tick.demandByType.Residential).toBe(0);
  expect(tick.demandByType.Commercial).toBe(0);
  expect(tick.demandByType["Data centers"]).toBe(
    original.demandByType["Data centers"],
  );
  expect(tick.demandByType.Industrial).toBe(original.demandByType.Industrial);
});

test("preview is isolated, matches the real forecast and monthly costs reach cash/history", () => {
  let game = createGame({ scenarioId: 106, seed: 4 });
  const untouched = cloneDeep(game);
  const preview = previewPolicy(game, change, 1);
  expect(game).toEqual(untouched);
  game = cloneDeep(gameReducer(game, schedulePolicy(change)));
  const now = getTimeFromTimeline(game.date.minute, game.timeline)!;
  const forecast = generateNewTimeline(
    game,
    now.cash,
    now.customers,
    TICKS_PER_MONTH * 2,
  );
  expect(forecast.slice(TICKS_PER_MONTH).map((t) => t.demandW)).toEqual(
    preview.changed,
  );
  month(game);
  expect(game.policies!.programs.efficiency.adoption).toBe(0.02);
  const expected = game.policies!.programs.efficiency.spending;
  expect(
    summarizeTimeline(game.timeline, game.startingYear).expensesPolicy,
  ).toBeCloseTo(expected);
  const first = cloneDeep(game.timeline);
  month(game);
  expect(game.monthlyHistory[0].expensesPolicy).toBeCloseTo(expected);
  expect(
    deriveExpandedSummary(game.monthlyHistory[0]).expenses,
  ).toBeGreaterThanOrEqual(expected);
  expect(
    first.every(
      (t) =>
        Object.values(t.demandByType).reduce((a, b) => a + b, 0) === t.demandW,
    ),
  ).toBe(true);
});

test("Off preserves installed upgrades through save/load and actions replay deterministically", () => {
  let game = cloneDeep(
    gameReducer(
      createGame({ scenarioId: 106, seed: 4 }),
      schedulePolicy(change),
    ),
  );
  month(game);
  game = cloneDeep(
    gameReducer(game, schedulePolicy({ ...change, tier: "Off", month: 2 })),
  );
  month(game);
  const stock = game.policies!.programs.efficiency.adoption;
  expect(stock).toBe(0.02);
  expect(game.policies!.programs.efficiency.spending).toBe(0);
  const restored = parseSave(
    JSON.parse(JSON.stringify(serializeSave(game))),
  )!.game;
  expect(restored.policies).toEqual(game.policies);
  const replay = createGameFromReplay(serializeReplay(game)!);
  month(replay);
  month(replay);
  expect(replay.policies).toEqual(game.policies);
  expect(replay.timeline.map((t) => t.cash)).toEqual(
    game.timeline.map((t) => t.cash),
  );
  month(restored);
  expect(restored.policies!.programs.efficiency.adoption).toBe(stock);
});

test("legacy neutral saves migrate; malformed stocks and new replay payloads are rejected", () => {
  const game = createGame({ scenarioId: 106 });
  const migrated = parseSave(serializeSave(game))!;
  expect(migrated.game.policies!.programs.solar.adoption).toBe(0);
  const bad = cloneDeep(migrated);
  bad.game.policies!.programs.solar.adoption = 2;
  expect(parseSave(bad)).toBeNull();
  const replay = serializeReplay(game)!;
  expect(
    decodeReplay({
      ...replay,
      actions: [
        {
          type: "schedulePolicy",
          minute: 0,
          payload: { ...change, tier: "Huge" },
        },
      ],
    }),
  ).toBeNull();
  expect(decodeReplay({ ...replay, version: 3 })).not.toBeNull();
});
