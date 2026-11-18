import cloneDeep from "lodash.clonedeep";
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from "../Constants";
import type {
  DeferredResidentialLoad,
  GameType,
  TickPresentFutureType,
} from "../Types";
import { DEFAULT_CUSTOM_SCENARIO } from "../data/Scenarios";
import { getSimLocation } from "../testing/SimData";
import { createGame } from "../testing/Simulator";
import { customerBillingRate } from "../helpers/Policies";
import { getTimeFromTimeline, MINUTES_PER_MONTH } from "../helpers/DateTime";
import { previewPolicy } from "../helpers/PolicyPreview";
import gameReducer, { generateNewTimeline, tickState } from "./Game";
import { cancelPolicy, schedulePolicy } from "./GameActions";

const queueWh = (queue: DeferredResidentialLoad[] | undefined) =>
  (queue ?? []).reduce((sum, entry) => sum + entry.energyWh, 0);

function gameAt(
  year: number,
  programs: { evCharging?: "On"; timeOfUse?: "On" } = {},
  location = getSimLocation("SF")!,
) {
  return createGame({
    scenarioId: 999,
    seed: 4,
    scenario: {
      ...DEFAULT_CUSTOM_SCENARIO,
      startingYear: year,
      location,
      locationId: location.id,
      cash: 1e10,
      startingCustomers: 10000,
      intertiesEnabled: false,
    },
    initialPrograms: programs,
  });
}

function nextMonth(game: GameType) {
  const month = game.date.monthsElapsed + 1;
  while (game.date.monthsElapsed < month) tickState(game);
}

function rebuild(game: GameType, ticks = TICKS_PER_MONTH, stepMinutes = 15) {
  const current = getTimeFromTimeline(game.date.minute, game.timeline)!;
  return generateNewTimeline(
    game,
    current.cash,
    current.customers,
    ticks,
    stepMinutes,
  );
}

test("household battery discharge cannot discount commercial demand through a recovered TOU load", () => {
  const game = gameAt(2040, { timeOfUse: "On" });
  game.policies!.programs.timeOfUse.tier = "On";
  const tick = cloneDeep(game.timeline[0]);
  tick.minute = 22 * 60;
  tick.demandByType = {
    Residential: 0,
    Commercial: 100,
    Industrial: 0,
    Transportation: 0,
    "Data Centers": 0,
    Mining: 0,
  };
  tick.shiftedResidentialW = 100;
  tick.customerBatteryDischargeW = 100;
  expect(customerBillingRate(game, tick)).toBe(game.dollarsPerkWh);
});

test.each([1980, 2015, 2025, 2039])(
  "both preview and scheduling reject EV enrollment when the local fleet is too small in %s",
  (year) => {
    const game = gameAt(year);
    const start = { id: "evCharging", tier: "On", month: 1 } as const;
    expect(gameReducer(game, schedulePolicy(start))).toBe(game);
    expect(() => previewPolicy(game, start, 13)).toThrow("not available");
  },
);

test("EV enrollment opens earlier in a market with more compatible cars", () => {
  const game = gameAt(2026, {}, getSimLocation("Oslo")!);
  const start = { id: "evCharging", tier: "On", month: 1 } as const;
  const scheduled = cloneDeep(gameReducer(game, schedulePolicy(start)));
  nextMonth(scheduled);
  expect(scheduled.policies!.programs.evCharging.adoption).toBeCloseTo(1 / 12);
  expect(scheduled.timeline.some((tick) => (tick.evShiftedW ?? 0) > 0)).toBe(
    true,
  );
});

test("the first eligible January can be scheduled in December", () => {
  const game = gameAt(2039);
  for (let i = 0; i < 11; i++) nextMonth(game);
  const start = { id: "evCharging", tier: "On", month: 12 } as const;
  expect(
    gameReducer(game, schedulePolicy(start)).policies!.programs.evCharging
      .pending,
  ).toEqual({
    tier: "On",
    month: 12,
  });
});

test("a scheduled EV preview includes actual participation expense and leaves live adoption alone", () => {
  const game = gameAt(2040);
  const before = cloneDeep(game.policies);
  const preview = previewPolicy(
    game,
    { id: "evCharging", tier: "On", month: 1 },
    1,
  );
  expect(preview.after.expensesPolicy).toBeGreaterThan(0);
  expect(preview.before.expensesPolicy).toBe(0);
  expect(preview.current).not.toEqual(preview.changed);
  expect(game.policies).toEqual(before);
});

test("EV payments reach the recorded monthly expenses and stop after cancellation", () => {
  const id = "evCharging";
  let game = gameAt(2040, { [id]: "On" });
  nextMonth(game);
  const monthlyCost = game.policies!.programs[id].spending;
  expect(monthlyCost).toBeGreaterThan(0);
  expect(
    game.timeline.reduce((sum, tick) => sum + (tick.expensesPolicy ?? 0), 0),
  ).toBeCloseTo(monthlyCost);
  const pending = { id, tier: "Off", month: 2 } as const;
  game = cloneDeep(gameReducer(game, schedulePolicy(pending)));
  expect(
    gameReducer(game, cancelPolicy(pending)).policies!.programs[id].pending,
  ).toBeUndefined();
  // A read-only reducer probe freezes shared state in development.
  game = cloneDeep(game);
  nextMonth(game);
  expect(game.monthlyHistory[0].expensesPolicy).toBeCloseTo(monthlyCost);
  expect(game.policies!.programs[id].tier).toBe("Off");
  expect(game.policies!.programs[id].spending).toBe(0);
  expect(
    game.timeline.reduce((sum, tick) => sum + (tick.expensesPolicy ?? 0), 0),
  ).toBe(0);
});

test("EV deferrals survive cancellation at the month boundary and return by the original deadline", () => {
  const id = "evCharging";
  let game = gameAt(2040);
  game = cloneDeep(
    gameReducer(
      game,
      schedulePolicy({ id, tier: "On", month: 1, startHour: 22 }),
    ),
  );
  nextMonth(game);
  game = cloneDeep(
    gameReducer(game, schedulePolicy({ id, tier: "Off", month: 2 })),
  );
  while (game.date.minute < MINUTES_PER_MONTH * 2 - 15) tickState(game);
  const lastActive = getTimeFromTimeline(game.date.minute, game.timeline)!;
  const owed = queueWh(lastActive.deferredCharging);
  expect(owed).toBeGreaterThan(0);
  const deadline = Math.max(
    ...lastActive.deferredCharging!.map((entry) => entry.recoveryEndMinute),
  );
  tickState(game);
  expect(game.policies!.programs[id].tier).toBe("Off");
  const after = game.timeline.filter((tick) => tick.minute < deadline);
  expect(after.reduce((sum, tick) => sum + (tick.evShiftedW ?? 0), 0)).toBe(0);
  expect(
    after.reduce(
      (sum, tick) => sum + (tick.evRecoveredW ?? 0) / TICKS_PER_HOUR,
      0,
    ),
  ).toBeCloseTo(owed, 6);
  expect(
    queueWh(
      game.timeline.find((tick) => tick.minute === deadline - 15)!
        .deferredCharging,
    ),
  ).toBeCloseTo(0, 6);
});

test("EV forecasts own their queues and conserve their deferred energy beside time-of-use", () => {
  const game = gameAt(2040, {
    evCharging: "On",
    timeOfUse: "On",
  });
  nextMonth(game);
  while (game.date.minute < MINUTES_PER_MONTH + 18 * 60) tickState(game);
  const snapshot = cloneDeep(game);
  const originalTimeline = JSON.stringify(game.timeline);
  const first = rebuild(game, TICKS_PER_MONTH * 2);
  expect(game.policies).toEqual(snapshot.policies);
  expect(JSON.stringify(game.timeline)).toBe(originalTimeline);
  const second = rebuild(game, TICKS_PER_MONTH * 2);
  const metrics = (timeline: TickPresentFutureType[]) =>
    timeline.map((tick) => [
      tick.demandW,
      tick.evShiftedW,
      tick.evRecoveredW,
      queueWh(tick.deferredCharging),
    ]);
  expect(metrics(first)).toEqual(metrics(second));
  let priorWh = queueWh(first[0].deferredChargingStart);
  expect(priorWh).toBeGreaterThan(0);
  for (const tick of first) {
    const currentWh = queueWh(tick.deferredCharging);
    expect(currentWh).toBeCloseTo(
      priorWh +
        ((tick.evShiftedW ?? 0) - (tick.evRecoveredW ?? 0)) / TICKS_PER_HOUR,
      5,
    );
    priorWh = currentWh;
  }
});
