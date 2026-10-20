import cloneDeep from "lodash.clonedeep";
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from "../Constants";
import type {
  DeferredResidentialLoad,
  GameType,
  TickPresentFutureType,
} from "../Types";
import { DEFAULT_CUSTOM_SCENARIO } from "../data/Scenarios";
import { createGame } from "../testing/Simulator";
import { programCustomers } from "../helpers/ProgramCustomers";
import { customerBillingRate } from "../helpers/Policies";
import { getTimeFromTimeline, MINUTES_PER_MONTH } from "../helpers/DateTime";
import { previewPolicy } from "../helpers/PolicyPreview";
import gameReducer, { generateNewTimeline, tickState } from "./Game";
import { cancelPolicy, schedulePolicy } from "./GameActions";

const queueWh = (queue: DeferredResidentialLoad[] | undefined) =>
  (queue ?? []).reduce((sum, entry) => sum + entry.energyWh, 0);

function gameAt(
  year: number,
  programs: { thermal?: "On"; evCharging?: "On"; timeOfUse?: "On" } = {},
) {
  return createGame({
    scenarioId: 999,
    seed: 4,
    scenario: {
      ...DEFAULT_CUSTOM_SCENARIO,
      startingYear: year,
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
  const game = gameAt(2025, { timeOfUse: "On" });
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

test("real monthly enrollment has no 1980 EV program and only limited 2015 flexibility", () => {
  const results = [1980, 2015, 2025].map((year) => {
    const game = gameAt(year, { thermal: "On", evCharging: "On" });
    nextMonth(game);
    const programs = game.policies!.programs;
    expect(programs.thermal.adoption).toBeGreaterThan(0);
    expect(programs.thermal.spending).toBeGreaterThan(0);
    return {
      ev: cloneDeep(programs.evCharging),
      shiftedWhPerCustomer:
        game.timeline.reduce(
          (sum, tick) => sum + (tick.evShiftedW ?? 0) / TICKS_PER_HOUR,
          0,
        ) / programCustomers(game),
    };
  });
  expect(results[0].ev.adoption).toBe(0);
  expect(results[0].ev.spending).toBe(0);
  expect(results[0].shiftedWhPerCustomer).toBe(0);
  expect(results[1].ev.adoption).toBeCloseTo(1 / 12);
  expect(results[2].ev.adoption).toBeCloseTo(1 / 12);
  expect(results[1].shiftedWhPerCustomer).toBeGreaterThan(0);
  expect(results[1].shiftedWhPerCustomer).toBeLessThan(
    results[2].shiftedWhPerCustomer / 10,
  );
  expect(results[1].ev.spending).toBeGreaterThan(0);
  expect(results[1].ev.spending).toBeLessThan(results[2].ev.spending);
});

test("a scheduled EV preview includes actual participation expense and leaves live adoption alone", () => {
  const game = gameAt(2025);
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

test.each(["thermal", "evCharging"] as const)(
  "%s payments reach the recorded monthly expenses and stop after cancellation",
  (id) => {
    let game = gameAt(2025, { [id]: "On" });
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
  },
);

test.each(["thermal", "evCharging"] as const)(
  "%s deferrals survive cancellation at the month boundary and return by the original deadline",
  (id) => {
    let game = gameAt(2025);
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
    const queueField =
      id === "thermal" ? "deferredThermal" : "deferredCharging";
    const recoveredField =
      id === "thermal" ? "thermalRecoveredW" : "evRecoveredW";
    const shiftedField = id === "thermal" ? "thermalShiftedW" : "evShiftedW";
    const owed = queueWh(lastActive[queueField]);
    expect(owed).toBeGreaterThan(0);
    const deadline = Math.max(
      ...lastActive[queueField]!.map((entry) => entry.recoveryEndMinute),
    );
    tickState(game);
    expect(game.policies!.programs[id].tier).toBe("Off");
    const after = game.timeline.filter((tick) => tick.minute < deadline);
    expect(
      after.reduce((sum, tick) => sum + (tick[shiftedField] ?? 0), 0),
    ).toBe(0);
    expect(
      after.reduce(
        (sum, tick) => sum + (tick[recoveredField] ?? 0) / TICKS_PER_HOUR,
        0,
      ),
    ).toBeCloseTo(owed, 6);
    expect(
      queueWh(
        game.timeline.find((tick) => tick.minute === deadline - 15)![
          queueField
        ],
      ),
    ).toBeCloseTo(0, 6);
  },
);

test("thermal and EV forecasts own their queues and conserve their deferred energy beside time-of-use", () => {
  const game = gameAt(2025, {
    thermal: "On",
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
      tick.thermalShiftedW,
      tick.thermalRecoveredW,
      queueWh(tick.deferredCharging),
      queueWh(tick.deferredThermal),
    ]);
  expect(metrics(first)).toEqual(metrics(second));
  for (const [queueField, startField, shiftedField, recoveredField] of [
    [
      "deferredThermal",
      "deferredThermalStart",
      "thermalShiftedW",
      "thermalRecoveredW",
    ],
    ["deferredCharging", "deferredChargingStart", "evShiftedW", "evRecoveredW"],
  ] as const) {
    let priorWh = queueWh(first[0][startField]);
    expect(priorWh).toBeGreaterThan(0);
    for (const tick of first) {
      const currentWh = queueWh(tick[queueField]);
      expect(currentWh).toBeCloseTo(
        priorWh +
          ((tick[shiftedField] ?? 0) - (tick[recoveredField] ?? 0)) /
            TICKS_PER_HOUR,
        5,
      );
      priorWh = currentWh;
    }
  }
});
