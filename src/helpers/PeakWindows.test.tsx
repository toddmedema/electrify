import cloneDeep from "lodash.clonedeep";
import { createGame, createGameFromReplay } from "../testing/Simulator";
import gameReducer, { generateNewTimeline, tickState } from "../reducers/Game";
import { schedulePolicy, cancelPolicy } from "../reducers/GameActions";
import { parseSave, serializeSave } from "../SaveGame";
import { serializeReplay, decodeReplay } from "../Replay";
import type { DeferredResidentialLoad, GameType } from "../Types";
import {
  applyPeakDemand,
  customerBillingRate,
  emptyPolicies,
  validPolicyChange,
  validPolicies,
} from "./Policies";
import { getTimeFromTimeline } from "./DateTime";
import { previewPolicy } from "./PolicyPreview";
import { policyWindowLabel, suggestedPolicyStartHour } from "./PolicyWindow";

let baseline: GameType;
beforeAll(() => {
  baseline = createGame({ scenarioId: 106, seed: 4 });
});

test.each(Array.from({ length: 24 }, (_, hour) => hour))(
  "window starting at %i conserves residential energy through midnight and stopping",
  (startHour) => {
    const game = cloneDeep(baseline);
    game.policies = emptyPolicies();
    game.policies.programs.timeOfUse = {
      tier: "Large",
      adoption: 0.5,
      spending: 0,
      startHour,
    };
    game.policies.programs.curtailment = {
      tier: "Large",
      adoption: 0.5,
      spending: 0,
      startHour,
    };
    let queue: DeferredResidentialLoad[] = [];
    let residentialBefore = 0,
      residentialAfter = 0,
      industrialRemoved = 0;
    for (let minute = 0; minute < 2880 + 420; minute += 15) {
      if (minute === 2880) {
        game.policies.programs.timeOfUse.tier = "Off";
        game.policies.programs.curtailment.tier = "Off";
      }
      const tick = cloneDeep(baseline.timeline[0]);
      tick.minute = minute;
      const watts = 100 + (minute % 1440) / 10;
      tick.demandByType = {
        Residential: watts,
        Commercial: 100,
        Industrial: 100,
        "Data centers": 100,
        Transportation: 100,
      };
      applyPeakDemand(game, tick, queue);
      queue = tick.deferredResidential!;
      residentialBefore += watts / 4;
      residentialAfter += tick.demandByType.Residential / 4;
      industrialRemoved += (100 - tick.demandByType.Industrial) / 4;
      expect(tick.demandByType.Commercial).toBe(100);
      expect(tick.demandByType.Industrial).toBeLessThanOrEqual(100);
      expect(customerBillingRate(game, tick)).toBeGreaterThanOrEqual(
        game.dollarsPerkWh * 0.9,
      );
    }
    expect(queue).toEqual([]);
    expect(residentialAfter).toBeCloseTo(residentialBefore, 7);
    expect(industrialRemoved).toBeCloseTo(80, 7);
  },
);

test("independent windows bill recovered energy at a discount even during a new peak", () => {
  const game = cloneDeep(baseline);
  game.policies = emptyPolicies();
  game.policies.programs.timeOfUse = {
    tier: "Large",
    adoption: 0.5,
    spending: 0,
    startHour: 0,
  };
  game.policies.programs.curtailment = {
    tier: "Large",
    adoption: 0.5,
    spending: 0,
    startHour: 8,
  };
  const tick = cloneDeep(baseline.timeline[0]);
  tick.minute = 1440;
  tick.demandByType = {
    Residential: 100,
    Commercial: 100,
    Industrial: 100,
    "Data centers": 100,
    Transportation: 100,
  };
  applyPeakDemand(game, tick, [
    { energyWh: 60, recoveryStartMinute: 1440, recoveryEndMinute: 1620 },
  ]);
  expect(tick.demandByType.Residential).toBe(110);
  expect(tick.demandByType.Industrial).toBe(100);
  // Residential: 50 ordinary + 40 peak-priced + 20 returned at discount.
  const bill = 50 + 40 * 1.3 + 20 * 0.9 + 100 + 200 * 0.95 + 100;
  expect(customerBillingRate(game, tick) * 510).toBeCloseTo(
    game.dollarsPerkWh * bill,
  );
});

test("window edits preview, cancel, save and replay across a month boundary", () => {
  let game = cloneDeep(baseline);
  const change = {
    id: "timeOfUse",
    tier: "Large",
    month: 1,
    startHour: 22,
  } as const;
  game = cloneDeep(gameReducer(game, schedulePolicy(change)));
  expect(game.policies!.programs.timeOfUse.pending).toEqual({
    tier: "Large",
    month: 1,
    startHour: 22,
  });
  const edit = { ...change, startHour: 9 };
  game = cloneDeep(gameReducer(game, schedulePolicy(edit)));
  expect(game.policies!.programs.timeOfUse.pending!.startHour).toBe(9);
  expect(
    gameReducer(game, cancelPolicy(change)).policies!.programs.timeOfUse
      .pending,
  ).toBeDefined();
  game = cloneDeep(gameReducer(game, cancelPolicy(edit)));
  expect(game.policies!.programs.timeOfUse.pending).toBeUndefined();
  game = cloneDeep(gameReducer(game, schedulePolicy(change)));
  while (game.date.minute < 2880) tickState(game);
  expect(game.policies!.programs.timeOfUse.startHour).toBe(22);
  const changedWindow = { ...change, month: 3, startHour: 10 };
  const estimate = previewPolicy(game, changedWindow, 3);
  expect(estimate.current).not.toEqual(estimate.changed);
  game = parseSave(JSON.parse(JSON.stringify(serializeSave(game))))!.game;
  const now = getTimeFromTimeline(game.date.minute, game.timeline)!;
  expect(now.deferredResidentialWhStart).toBeGreaterThan(0);
  game.timeline = generateNewTimeline(game, now.cash, now.customers);
  const once = cloneDeep(game.timeline);
  game = parseSave(JSON.parse(JSON.stringify(serializeSave(game))))!.game;
  game.timeline = generateNewTimeline(game, now.cash, now.customers);
  expect(game.timeline.map((t) => t.deferredResidential)).toEqual(
    once.map((t) => t.deferredResidential),
  );
  const replay = createGameFromReplay(serializeReplay(game)!);
  while (replay.date.minute < game.date.minute) tickState(replay);
  expect(replay.policies).toEqual(game.policies);
  expect(
    getTimeFromTimeline(replay.date.minute, replay.timeline)!
      .deferredResidential,
  ).toEqual(now.deferredResidential);
});

test.each([-1, 24, 1.5, NaN, "22", null])(
  "rejects invalid start hour %s",
  (startHour) => {
    expect(
      validPolicyChange({
        id: "timeOfUse",
        tier: "Large",
        month: 1,
        startHour,
      }),
    ).toBe(false);
    const policies = emptyPolicies();
    Object.assign(policies.programs.timeOfUse, { startHour });
    expect(validPolicies(policies, 0)).toBe(false);
    const replay = serializeReplay(baseline)!;
    replay.actions.push({
      type: "schedulePolicy",
      minute: 0,
      payload: { id: "timeOfUse", tier: "Large", month: 1, startHour },
    } as (typeof replay.actions)[number]);
    expect(decodeReplay(replay)).toBeNull();
  },
);

test("window suggestion covers upcoming peak; labels clarify midnight", () => {
  const game = cloneDeep(baseline);
  game.timeline = [
    Object.assign(cloneDeep(game.timeline[0]), { minute: 600, demandW: 1000 }),
    Object.assign(cloneDeep(game.timeline[0]), { minute: 1440, demandW: 800 }),
    Object.assign(cloneDeep(game.timeline[0]), { minute: 2040, demandW: 100 }),
  ];
  expect(suggestedPolicyStartHour(game)).toBe(23);
  expect(policyWindowLabel(22)).toBe("22:00–02:00 (next day)");
  expect(policyWindowLabel(9)).toBe("09:00–13:00");
});
