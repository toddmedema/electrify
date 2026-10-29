import { createNextState, freeze } from "@reduxjs/toolkit";
import cloneDeep from "lodash.clonedeep";
import { TICK_MINUTES, TICK_MS, TICKS_PER_MONTH } from "../Constants";
import { getScenario } from "../data/Scenarios";
import {
  copyCommitmentMetadata,
  serializeCommitmentMetadata,
} from "../helpers/Commitment";
import { getTimeFromTimeline } from "../helpers/DateTime";
import { getStore } from "../StoreRegistry";
import { createGame } from "../testing/Simulator";
import { FacilityUpgradeType, GameType } from "../Types";
import gameReducer, {
  buildTransmissionLine,
  loaded,
  quit,
  resume,
  setSpeed,
  tick,
  tickState,
  upgradeTransmissionLine,
} from "./Game";

function mutableCopy(state: GameType): GameType {
  const copy = cloneDeep(state);
  // The forecast's non-enumerable dispatch metadata is an input to live commitment decisions.
  state.timeline.forEach((tick, index) =>
    copyCommitmentMetadata(tick, copy.timeline[index]),
  );
  return copy;
}

function draftTick(state: GameType): GameType {
  return createNextState(state, (draft) => {
    tickState(draft);
  });
}

function expectSameState(
  actual: GameType,
  expected: GameType,
  commitmentFromMinute = -Infinity,
) {
  expect(JSON.parse(JSON.stringify(actual))).toEqual(
    JSON.parse(JSON.stringify(expected)),
  );
  expect(
    serializeCommitmentMetadata(
      actual.timeline.filter((frame) => frame.minute >= commitmentFromMinute),
    ),
  ).toEqual(
    serializeCommitmentMetadata(
      expected.timeline.filter((frame) => frame.minute >= commitmentFromMinute),
    ),
  );
}

describe("live tick working state", () => {
  it.each([1, TICKS_PER_MONTH - 1, 12 * TICKS_PER_MONTH - 1])(
    "matches plain simulation and preserves its frozen input after %i ticks",
    (ticks) => {
      const state = createGame({
        scenarioId: 103,
        seed: 12345,
        difficulty: "Employee",
        dollarsPerkWh: 0.035,
      });
      for (let i = 0; i < ticks; i++) tickState(state);
      const before = mutableCopy(state);
      const expected = mutableCopy(state);
      tickState(expected);
      freeze(state, true);

      const actual = draftTick(state);

      expectSameState(actual, expected);
      expectSameState(state, before);
      expect(actual.facilities).not.toBe(state.facilities);
      expect(actual.location).toBe(state.location);
    },
  );

  it("retains unchanged ordinary-tick references for UI selectors", () => {
    const state = createGame({ scenarioId: 103, seed: 12345 });
    tickState(state);
    freeze(state, true);
    const actual = draftTick(state);
    expect(actual.monthlyHistory).toBe(state.monthlyHistory);
    expect(actual.eventLog).toBe(state.eventLog);
    expect(actual.reportedEventKeys).toBe(state.reportedEventKeys);
    expect(actual.worldEvents).toBe(state.worldEvents);
    expect(actual.policies).toBe(state.policies);
    expect(actual.transmission).toBe(state.transmission);
    expect(actual.timeline[0]).toBe(state.timeline[0]);
    expect(actual.timeline.at(-1)).toBe(state.timeline.at(-1));
  });

  it.each([2, 120])(
    "preserves a %i-tick presentation batch across a rollover",
    (ticks) => {
      const state = createGame({
        scenarioId: 103,
        seed: 12345,
        difficulty: "Employee",
        dollarsPerkWh: 0.035,
      });
      for (let i = 0; i < TICKS_PER_MONTH - 1; i++) tickState(state);
      const before = mutableCopy(state);
      const expected = mutableCopy(state);
      for (let i = 0; i < ticks; i++) tickState(expected);
      freeze(state, true);
      const actual = createNextState(state, (draft) => {
        for (let i = 0; i < ticks; i++) tickState(draft);
      });
      expectSameState(actual, expected);
      expectSameState(state, before);
    },
  );

  it("keeps nested intertie construction and debt private", () => {
    let state = createGame({ scenarioId: 100, seed: 61 });
    getTimeFromTimeline(state.date.minute, state.timeline)!.cash = 100000000000;
    state = mutableCopy(
      gameReducer(
        state,
        buildTransmissionLine({
          corridorId: "california-north",
          financed: true,
        }),
      ),
    );
    state.transmission!.lines[0].yearsToBuildLeft = 0;
    state = mutableCopy(
      gameReducer(
        state,
        upgradeTransmissionLine({
          corridorId: "california-north",
          financed: true,
        }),
      ),
    );
    const before = mutableCopy(state);
    const expected = mutableCopy(state);
    tickState(expected);
    freeze(state, true);

    const actual = draftTick(state);

    expectSameState(actual, expected);
    expectSameState(state, before);
    expect(
      actual.transmission!.lines[0].upgrade!.yearsToBuildLeft,
    ).toBeLessThan(state.transmission!.lines[0].upgrade!.yearsToBuildLeft);
    expect(actual.transmission!.lines[0].loanAmountLeft).toBeLessThan(
      state.transmission!.lines[0].loanAmountLeft,
    );
  });

  it("removes a completed blackout without mutating the previous snapshot", () => {
    const state = createGame({ scenarioId: 103, seed: 12345 });
    state.blackout = { startMinute: 0, unservedWh: 100 };
    state.timeline[1].demandW = 0;
    const before = mutableCopy(state);
    const expected = mutableCopy(state);
    tickState(expected);
    freeze(state, true);

    const actual = draftTick(state);

    expectSameState(actual, expected);
    expect(actual).not.toHaveProperty("blackout");
    expectSameState(state, before);
    expect(actual.eventLog).not.toBe(state.eventLog);
  });

  it.each<FacilityUpgradeType>([
    "hailResistant",
    "coldWeatherPackage",
    "combinedCycle",
  ])("isolates a completed %s retrofit", (upgrade) => {
    const state = createGame({ scenarioId: 104, seed: 61 });
    const facility = state.facilities.find(
      (item) => item.gasCycle === "simple",
    )!;
    facility.upgradeInProgress = {
      upgrade,
      cost: 1,
      startsMinute: 0,
      completesMinute: TICK_MINUTES,
    };
    const before = mutableCopy(state);
    const expected = mutableCopy(state);
    tickState(expected);
    freeze(state, true);

    const actual = draftTick(state);

    expectSameState(actual, expected);
    expectSameState(state, before);
    expect(
      actual.facilities.find((item) => item.id === facility.id),
    ).not.toHaveProperty("upgradeInProgress");
  });

  it("isolates completion of the tutorial intertie exercise and its forecast", () => {
    const state = createGame({ scenarioId: 112, seed: 61 });
    state.tutorialStep = getScenario(112)!.tutorialSteps!.findIndex(
      (step) => step.phase === "INTERTIE_STRESS_SUPPLY",
    );
    state.tutorialIntertieStress = {
      active: true,
      startsMinute: 0,
      suppliedTicks: TICKS_PER_MONTH - 1,
      completed: false,
    };
    state.timeline[1].demandW = 0;
    const before = mutableCopy(state);
    const expected = mutableCopy(state);
    tickState(expected);
    freeze(state, true);

    const actual = draftTick(state);

    expectSameState(actual, expected);
    expectSameState(state, before);
    expect(actual.tutorialIntertieStress?.completed).toBe(true);
    expect(actual.speed).toBe("PAUSED");
  });
});

describe("live presentation tick batches", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    getStore().dispatch(quit());
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  function presentBatch(state: GameType, steps: number) {
    let wallClockMs = 0;
    jest.spyOn(performance, "now").mockImplementation(() => wallClockMs);
    getStore().dispatch(quit());
    getStore().dispatch(tick());
    getStore().dispatch(resume(state));
    getStore().dispatch(loaded());
    getStore().dispatch(setSpeed("ULTRA"));
    const before = getStore().getState().game;
    const saved = mutableCopy(before);
    const expected = mutableCopy(before);
    for (let i = 0; i < steps; i++) {
      tickState(expected);
      if (!expected.inGame || expected.speed === "PAUSED") break;
    }

    wallClockMs = steps * TICK_MS.ULTRA;
    getStore().dispatch(tick());
    const actual = getStore().getState().game;
    expectSameState(actual, expected);
    expectSameState(before, saved);
    return { actual, before };
  }

  it.each([1, TICKS_PER_MONTH - 1, 12 * TICKS_PER_MONTH - 1])(
    "isolates a real 12-step presentation batch after %i ticks",
    (ticks) => {
      const state = createGame({
        scenarioId: 103,
        seed: 12345,
        difficulty: "Employee",
        dollarsPerkWh: 0.035,
        storyEffectsEnabled: false,
      });
      for (let i = 0; i < ticks; i++) tickState(state);
      const { actual, before } = presentBatch(state, 12);
      expect(actual.date.minute - before.date.minute).toBe(12 * TICK_MINUTES);
    },
  );

  it("keeps unchanged references in a real ordinary presentation batch", () => {
    const state = createGame({ scenarioId: 103, seed: 12345 });
    tickState(state);
    const { actual, before } = presentBatch(state, 12);
    expect(actual.date.monthsElapsed).toBe(before.date.monthsElapsed);
    expect(actual.monthlyHistory).toBe(before.monthlyHistory);
    expect(actual.worldEvents).toBe(before.worldEvents);
    expect(actual.timeline[0]).toBe(before.timeline[0]);
    expect(actual.timeline[20]).toBe(before.timeline[20]);
  });

  it.each([12, 120])(
    "stops and resumes at the declarative official onset in a real %i-step ULTRA/catch-up batch",
    (steps) => {
      const state = createGame({ scenarioId: 113, difficulty: "CEO", seed: 1 });
      for (let i = 0; i < 36 * TICKS_PER_MONTH - 1; i++) tickState(state);
      const { actual, before } = presentBatch(state, steps);
      expect(actual.date.minute - before.date.minute).toBe(TICK_MINUTES);
      expect(actual.speed).toBe("PAUSED");
      expect(actual.worldEvents.active).toContainEqual(
        expect.objectContaining({
          key: "story:113:load-shedding:availability-step-1",
        }),
      );
      expect(actual.customScenario).toBeUndefined();
      const continued = presentBatch(mutableCopy(actual), steps);
      expect(continued.actual.date.minute - continued.before.date.minute).toBe(
        steps * TICK_MINUTES,
      );
      expect(
        continued.actual.worldEvents.occurrences.filter(
          (event) =>
            event.key === "story:113:load-shedding:availability-step-1",
        ),
      ).toHaveLength(1);
    },
  );

  it("stops a catch-up batch when a tutorial pauses before rollover", () => {
    const state = createGame({ scenarioId: 103, seed: 12345 });
    for (let i = 0; i < TICKS_PER_MONTH - 1; i++) tickState(state);
    state.tutorialStep = 17;
    state.tutorialIntertieStress = {
      active: true,
      startsMinute: state.date.minute,
      suppliedTicks: 0,
      completed: false,
    };
    const { actual, before } = presentBatch(state, 12);
    expect(actual.date).toBe(before.date);
    expect(actual.speed).toBe("PAUSED");
    expect(actual.monthlyHistory).toBe(before.monthlyHistory);
    expect(actual.worldEvents).toBe(before.worldEvents);
  });

  it("stops the batch at an authored January decision after recording rollover", () => {
    const state = createGame({
      scenarioId: 103,
      seed: 12345,
      difficulty: "Employee",
      dollarsPerkWh: 0.035,
    });
    for (let i = 0; i < 12 * TICKS_PER_MONTH - 1; i++) tickState(state);
    const { actual, before } = presentBatch(state, 12);
    expect(actual.date.minute - before.date.minute).toBe(TICK_MINUTES);
    expect(actual.speed).toBe("PAUSED");
    expect(actual.monthlyHistory.length).toBe(before.monthlyHistory.length + 1);
    expect(actual.worldEvents).not.toBe(before.worldEvents);
  });
});
