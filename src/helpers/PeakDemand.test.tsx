import cloneDeep from "lodash.clonedeep";
import {
  createGame,
  createGameFromReplay,
  runSimulation,
} from "../testing/Simulator";
import gameReducer, {
  delta,
  generateNewTimeline,
  tickState,
} from "../reducers/Game";
import { schedulePolicy, cancelPolicy } from "../reducers/GameActions";
import {
  applyPeakDemand,
  applyPolicyDemand,
  customerBillingRate,
  emptyPolicies,
  advancePolicies,
} from "./Policies";
import { previewPolicy } from "./PolicyPreview";
import {
  updateCustomerRate,
  nextCustomerCount,
  customerMarketSizeAt,
  getMarketRate,
} from "./Customers";
import { getScenario } from "../data/Scenarios";
import {
  getDateFromMinute,
  getTimeFromTimeline,
  MINUTES_PER_MONTH,
} from "./DateTime";
import {
  GAME_TO_REAL_YEARS,
  TICKS_PER_HOUR,
  TICKS_PER_MONTH,
} from "../Constants";
import { GameType } from "../Types";
import { parseSave, serializeSave, SAVE_VERSION } from "../SaveGame";
import { decodeReplay, serializeReplay, REPLAY_VERSION } from "../Replay";

let baseline: GameType;
beforeAll(() => {
  baseline = createGame({ scenarioId: 106, seed: 4 });
});

test.each([105, 106, 111])(
  "active tariffs/contracts with rebates preserve all annual simulation invariants in scenario %i",
  (scenarioId) => {
    const result = runSimulation({
      scenarioId,
      seed: 4,
      months: 12,
      initialPrograms: {
        timeOfUse: "Large",
        curtailment: "Large",
        efficiency: "Small",
        solar: "Small",
      },
    });
    expect(result.violations).toEqual([]);
  },
);
function offers() {
  const game = cloneDeep(baseline);
  game.policies = emptyPolicies();
  game.policies.programs.timeOfUse.tier = "Large";
  game.policies.programs.curtailment.tier = "Small";
  return game;
}
function demand(minute: number) {
  const tick = cloneDeep(baseline.timeline[0]);
  tick.minute = minute;
  tick.demandByType = {
    Residential: 100,
    Commercial: 100,
    Industrial: 100,
    "Data centers": 100,
    Transportation: 100,
  };
  return tick;
}
function month(game: GameType) {
  const target = game.date.monthsElapsed + 1;
  while (game.date.monthsElapsed < target) tickState(game);
}

test.each([0, 6 * 60, 17 * 60 - 1, 17 * 60, 21 * 60 - 1, 21 * 60, 1440])(
  "local window and correctly weighted bills at minute %i",
  (minute) => {
    const game = offers();
    const tick = demand(minute);
    const peak = minute >= 1020 && minute < 1260;
    const overnight = minute % 1440 < 360;
    applyPeakDemand(game, tick);
    expect(tick.demandByType.Residential).toBe(peak ? 90 : 100);
    expect(tick.demandByType.Commercial).toBe(peak ? 90 : 100);
    expect(tick.demandByType.Industrial).toBe(peak ? 95 : 100);
    expect(tick.demandByType["Data centers"]).toBe(peak ? 95 : 100);
    expect(tick.demandByType.Transportation).toBe(100);
    // Explicit enrolled/un-enrolled bills: contracts and TOU never share a sector.
    const bill = peak
      ? 2 * (50 + 40 * 1.3) + 2 * (75 + 20 * 0.9) + 100
      : 2 * (50 + 50 * (overnight ? 0.9 : 1)) + 2 * (75 + 25 * 0.9) + 100;
    const watts = Object.values(tick.demandByType).reduce((a, b) => a + b, 0);
    expect(customerBillingRate(game, tick) * watts).toBeCloseTo(
      bill * game.dollarsPerkWh,
    );
  },
);

test("season/month windows repeat; no enrolled load means no effect; rebates compose before offers", () => {
  const game = offers();
  for (const m of [0, 6, 12]) {
    const tick = demand(m * MINUTES_PER_MONTH + 18 * 60);
    applyPeakDemand(game, tick);
    expect(tick.demandByType.Residential).toBe(90);
  }
  const tick = demand(18 * 60);
  game.policies!.programs.efficiency.adoption = 1;
  applyPolicyDemand(game, tick);
  applyPeakDemand(game, tick);
  expect(tick.demandByType.Residential).toBe(72);
  tick.demandByType = {
    Residential: 0,
    Commercial: 0,
    Industrial: 0,
    "Data centers": 0,
    Transportation: 100,
  };
  const before = cloneDeep(tick);
  applyPeakDemand(game, tick);
  expect(tick).toEqual(before);
  expect(customerBillingRate(game, tick)).toBe(game.dollarsPerkWh);
  tick.demandByType.Transportation = 0;
  expect(customerBillingRate(game, tick)).toBe(game.dollarsPerkWh);
});

test("Off removes all operating participation next month without changing installed rebates", () => {
  const game = offers();
  game.policies!.programs.efficiency.adoption = 0.3;
  advancePolicies(game, 1);
  expect(game.policies!.programs.timeOfUse.adoption).toBe(0.5);
  expect(game.policies!.programs.curtailment.adoption).toBe(0.25);
  for (const id of ["timeOfUse", "curtailment"] as const) {
    game.policies!.programs[id].pending = { tier: "Off", month: 2 };
  }
  advancePolicies(game, 2);
  for (const id of ["timeOfUse", "curtailment"] as const) {
    expect(game.policies!.programs[id]).toEqual({
      tier: "Off",
      adoption: 0,
      spending: 0,
    });
  }
  const tick = demand(18 * 60);
  applyPeakDemand(game, tick);
  expect(tick.demandByType.Residential).toBe(100);
  expect(customerBillingRate(game, tick)).toBe(game.dollarsPerkWh);
  expect(game.policies!.programs.efficiency.adoption).toBe(0.3);
});

test("scheduled preview uses real demand/billing; even partial and zero supply bill only delivered energy", () => {
  const change = { id: "timeOfUse", tier: "Large", month: 1 } as const;
  const preview = previewPolicy(baseline, change, 1);
  let game = cloneDeep(gameReducer(baseline, schedulePolicy(change)));
  const now = game.timeline[0];
  const forecast = generateNewTimeline(
    game,
    now.cash,
    now.customers,
    TICKS_PER_MONTH * 2,
  );
  expect(forecast.slice(TICKS_PER_MONTH).map((t) => t.demandW)).toEqual(
    preview.changed,
  );
  expect(preview.spending).toBe(0);
  expect(preview.current).not.toEqual(preview.changed);
  game = cloneDeep(
    gameReducer(
      game,
      schedulePolicy({ id: "curtailment", tier: "Large", month: 1 }),
    ),
  );
  month(game);
  // Force a genuine shortage, then remove all generators to exercise zero supply.
  game.facilities.forEach((f) => {
    f.peakW *= 0.1;
  });
  for (const empty of [false, true]) {
    if (empty) game.facilities = [];
    const start = getTimeFromTimeline(game.date.minute, game.timeline)!;
    const ticks = generateNewTimeline(game, start.cash, start.customers);
    expect(ticks.some((t) => t.supplyW < t.demandW)).toBe(true);
    for (const t of ticks) {
      const expected =
        (((Math.min(t.supplyW, t.demandW) / TICKS_PER_HOUR) *
          GAME_TO_REAL_YEARS) /
          1000) *
        t.customerBillingRate!;
      expect(t.revenue - (t.revenueExports || 0)).toBeCloseTo(expected);
      expect(t.customerBillingRate).toBeGreaterThanOrEqual(
        game.dollarsPerkWh * 0.9,
      );
      expect(t.customerBillingRate).toBeLessThanOrEqual(
        game.dollarsPerkWh * 1.3,
      );
    }
  }
});

test("changing the base rate updates live bills immediately while recorded history stays unchanged", () => {
  let game = createGame({
    scenarioId: 106,
    seed: 4,
    initialPrograms: { timeOfUse: "Large", curtailment: "Small" },
  });
  month(game);
  const history = cloneDeep(game.monthlyHistory);
  game = cloneDeep(
    gameReducer(game, delta({ dollarsPerkWh: game.dollarsPerkWh * 2 })),
  );
  tickState(game);
  const tick = getTimeFromTimeline(game.date.minute, game.timeline)!;
  expect(tick.customerBillingRate).toBe(customerBillingRate(game, tick));
  expect(tick.revenue - (tick.revenueExports || 0)).toBeCloseTo(
    (((Math.min(tick.supplyW, tick.demandW) / TICKS_PER_HOUR) *
      GAME_TO_REAL_YEARS) /
      1000) *
      tick.customerBillingRate!,
  );
  expect(game.monthlyHistory).toEqual(history);
});

test("constant curtailment credits drive the same effective-price memory used for customer retention", () => {
  const game = createGame({
    scenarioId: 106,
    seed: 4,
    initialPrograms: { curtailment: "Large" },
  });
  month(game);
  const scenario = getScenario(game.scenarioId)!;
  const current = getTimeFromTimeline(game.date.minute, game.timeline)!;
  const ticks = generateNewTimeline(game, current.cash, current.customers);
  let checked = 0;
  for (let i = 1; i < ticks.length; i++) {
    const previous = ticks[i - 1];
    const tick = ticks[i];
    expect(previous.customerBillingRate).toBeLessThan(game.dollarsPerkWh);
    expect(tick.customerRate).toBe(
      updateCustomerRate(previous.customerRate, previous.customerBillingRate!),
    );
    if (tick.supplyW < tick.demandW) continue;
    expect(tick.customers).toBe(
      nextCustomerCount({
        customers: previous.customers,
        customerRate: tick.customerRate,
        marketRate: getMarketRate(
          scenario.dollarsPerkWh,
          getDateFromMinute(tick.minute, game.startingYear),
          game.startingYear,
          game.seed,
        ),
        marketSize: customerMarketSizeAt(game.customerMarketSize, tick.minute),
        ownership: scenario.ownership,
      }),
    );
    checked++;
  }
  expect(checked).toBeGreaterThan(0);
});

test("both offer actions cancel, save, resume and replay deterministically through stopping", () => {
  let game = cloneDeep(baseline);
  for (const id of ["timeOfUse", "curtailment"] as const) {
    const change = { id, tier: "Small", month: 1 } as const;
    game = cloneDeep(gameReducer(game, schedulePolicy(change)));
    expect(
      gameReducer(game, cancelPolicy(change)).policies!.programs[id].pending,
    ).toBeUndefined();
    game = cloneDeep(game);
  }
  month(game);
  const restored = parseSave(
    JSON.parse(JSON.stringify(serializeSave(game))),
  )!.game;
  const continued = cloneDeep(game);
  month(restored);
  month(continued);
  expect(restored.timeline.map((t) => [t.cash, t.customerBillingRate])).toEqual(
    continued.timeline.map((t) => [t.cash, t.customerBillingRate]),
  );
  for (const id of ["timeOfUse", "curtailment"] as const) {
    const change = { id, tier: "Off", month: 2 } as const;
    game = cloneDeep(gameReducer(game, schedulePolicy(change)));
  }
  month(game);
  const replay = createGameFromReplay(serializeReplay(game)!);
  month(replay);
  month(replay);
  expect(replay.policies).toEqual(game.policies);
  expect(
    replay.timeline.map((t) => [t.cash, t.demandW, t.customerBillingRate]),
  ).toEqual(
    game.timeline.map((t) => [t.cash, t.demandW, t.customerBillingRate]),
  );
  expect(restored.timeline.map((t) => t.revenue)).toEqual(
    parseSave(
      JSON.parse(JSON.stringify(serializeSave(restored))),
    )!.game.timeline.map((t) => t.revenue),
  );
  const invalid = serializeSave(restored);
  invalid.game.timeline[0].customerBillingRate = -1;
  expect(parseSave(invalid)).toBeNull();
  expect(
    parseSave({ ...serializeSave(game), version: SAVE_VERSION - 1 }),
  ).toBeNull();
  expect(
    decodeReplay({ ...serializeReplay(game), version: REPLAY_VERSION - 1 }),
  ).toBeNull();
  expect(REPLAY_VERSION).toBe(10);
  expect(decodeReplay(serializeReplay(game))).not.toBeNull();
});
