import { createNextState as produce } from "@reduxjs/toolkit";
import { CUSTOM_SCENARIO_ID, SCENARIOS, TUTORIALS } from "../data/Scenarios";
import { getStore } from "../StoreRegistry";
import { getPlayedScenarioIds } from "../LocalStorage";
import { createGame } from "../testing/Simulator";
import {
  loaded,
  hasChronicBlackouts,
  quit,
  resume,
  scenarioObjectiveFailure,
  setSpeed,
  tick as tickAction,
  tickState,
} from "./Game";
import { TICK_MS } from "../Constants";
import { GameType, MonthlyHistoryType, ScenarioType } from "../Types";
import * as User from "./User";

/**
 * The end of scenario triggers hand their dialogs off to setTimeout so that the autosave
 * subscriber doesn't write the finished run straight back. Everything those callbacks read has to
 * come out of the Immer draft first, because the draft is revoked the moment the reducer returns.
 *
 * The rest of the suite ticks a plain object rather than a draft, so it can't see this - these run
 * through produce() the way createSlice does.
 */

// Custom rather than authored: for a custom game the scenario itself lives on the slice, so the
// end of game dialog reads its title, message and ownership off the draft too
function customScenario(overrides: Partial<ScenarioType>): ScenarioType {
  return {
    ...SCENARIOS[0],
    id: CUSTOM_SCENARIO_ID,
    tutorialSteps: undefined,
    ...overrides,
  };
}

function tick(state: GameType): GameType {
  return produce(state, (draft: GameType) => {
    tickState(draft);
  });
}

/**
 * Hands a part-played run to the real store and lets its own tick loop carry it to `untilMonth`.
 *
 * produce() above is the cheap way to cover ground, but it isn't a dispatch: everything the tick
 * reducer is forbidden from doing while Redux is inside it - reading the store back, most of all -
 * looks perfectly fine there. The last month of a run is where the end of scenario triggers live,
 * so that's the stretch worth paying for.
 */
function playOutOnTheStore(state: GameType, untilMonth: number) {
  // The loop paces itself off the wall clock, which stands still inside a synchronous test - so
  // the clock is what gets driven here, one tick's worth per dispatch
  let wallClockMs = 0;
  const now = jest
    .spyOn(performance, "now")
    .mockImplementation(() => wallClockMs);
  try {
    getStore().dispatch(resume(state));
    getStore().dispatch(loaded()); // Marks the game live, the way the loading screen does
    getStore().dispatch(setSpeed("FAST"));
    // Bounded so that a tick loop which stops advancing fails the assertion below rather than
    // hanging the suite
    for (
      let i = 0;
      i < 10000 && getStore().getState().game.date.monthsElapsed < untilMonth;
      i++
    ) {
      wallClockMs += TICK_MS.FAST * 2;
      getStore().dispatch(tickAction());
    }
  } finally {
    now.mockRestore();
  }
  expect(getStore().getState().game.date.monthsElapsed).toBe(untilMonth);
}

describe("ending a scenario from inside the reducer", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("survives to the end of the term without reading the revoked draft", () => {
    const scenario = customScenario({ durationMonths: 2 });
    let state = createGame({ scenarioId: CUSTOM_SCENARIO_ID, scenario });
    while (state.date.monthsElapsed < (scenario.durationMonths as number)) {
      state = tick(state);
    }
    expect(() => jest.runOnlyPendingTimers()).not.toThrow();
  });

  /**
   * The score screen is a component now rather than JSX built in here, so what the reducer owes it
   * is the numbers. previousBest in particular is read before the score write, so that "was 640"
   * reports the run before this one and not the one just finished.
   */
  it("hands the score screen everything it needs", () => {
    getStore().dispatch(quit());
    const scenario = customScenario({ durationMonths: 2, name: "A Test Run" });
    let state = createGame({ scenarioId: CUSTOM_SCENARIO_ID, scenario });
    while (state.date.monthsElapsed < (scenario.durationMonths as number)) {
      state = tick(state);
    }
    jest.runOnlyPendingTimers();

    const victory = getStore().getState().ui.victory;
    expect(victory).not.toBeNull();
    expect(victory?.scenarioName).toBe("A Test Run");
    expect(Object.keys(victory?.breakdown || {}).length).toBeGreaterThan(0);
    expect(victory?.debrief).toEqual(
      expect.objectContaining({
        startingFleet: expect.any(Array),
        finalFleet: expect.any(Array),
        reliability: expect.any(Number),
        highlights: expect.any(Array),
      }),
    );
    // Every custom game shares one id, so its score belongs to nothing comparable
    expect(victory?.ranked).toBe(false);
    // Opening the score screen stops the clock, the way any other dialog does
    expect(getStore().getState().game.speed).toBe("PAUSED");
  });

  /**
   * The freeze this guards against: the reducer read the player's previous best straight off the
   * store, which Redux refuses to do while a reducer is running. The throw came out of the tick
   * loop's own setTimeout, so nothing rescheduled it and nothing opened the dialog - the game
   * stopped dead on the last month of every run, score screen and all.
   */
  it("keeps the clock alive through the end of a scored run", () => {
    getStore().dispatch(quit());
    const scenario = SCENARIOS.find(
      (s: ScenarioType) => s.id === 100,
    ) as ScenarioType;
    const duration = scenario.durationMonths as number;
    let state = createGame({ scenarioId: scenario.id });
    // Cheap up to the second to last month, then the store drives the one that ends the run
    while (state.date.monthsElapsed < duration - 1) {
      state = tick(state);
    }
    playOutOnTheStore(state, duration);
    jest.runOnlyPendingTimers();

    const victory = getStore().getState().ui.victory;
    expect(victory).not.toBeNull();
    expect(victory?.scenarioName).toBe(scenario.name);
    // An authored scenario is the case that reads the previous best and submits a score
    expect(victory?.ranked).toBe(true);
  });

  it("goes bankrupt without reading the revoked draft", () => {
    // No cash and free electricity: operating the fleet puts it under within a month
    const scenario = customScenario({ cash: 0, durationMonths: 12 * 20 });
    let state = createGame({
      scenarioId: CUSTOM_SCENARIO_ID,
      scenario,
      dollarsPerkWh: 0,
    });
    while (state.date.monthsElapsed < 2) {
      state = tick(state);
    }
    expect(state.monthlyHistory[0].cash).toBeLessThan(0);
    expect(() => jest.runOnlyPendingTimers()).not.toThrow();
  });

  it("shows and submits a score after bankruptcy", () => {
    const submitHighscore = jest.spyOn(User, "submitHighscore");
    getStore().dispatch(quit());
    const scenario = SCENARIOS.find(
      (s: ScenarioType) => s.id === 100,
    ) as ScenarioType;
    const state = createGame({ scenarioId: scenario.id });
    // Start the month already overdrawn so this test reaches the bankruptcy path without relying
    // on the removed marketing expense as an artificial cash drain.
    state.timeline.forEach((tick) => {
      tick.cash = -1;
    });

    playOutOnTheStore(state, 1);
    expect(getStore().getState().game.monthlyHistory[0].cash).toBeLessThan(0);
    jest.runOnlyPendingTimers();

    const victory = getStore().getState().ui.victory;
    expect(victory).toEqual(
      expect.objectContaining({
        scenarioId: scenario.id,
        outcome: "bankrupt",
        ranked: true,
      }),
    );
    expect(submitHighscore).toHaveBeenCalledWith(
      expect.objectContaining({
        scenarioId: scenario.id,
        score: victory?.score,
      }),
    );
  });

  it("shows and submits a score after the player is fired", () => {
    const submitHighscore = jest.spyOn(User, "submitHighscore");
    getStore().dispatch(quit());
    const scenario = SCENARIOS.find(
      (s: ScenarioType) => s.id === 100,
    ) as ScenarioType;
    const state = createGame({ scenarioId: scenario.id });
    while (state.date.monthsElapsed < 3) {
      tickState(state);
    }
    const blackoutMonth: MonthlyHistoryType = {
      year: scenario.startingYear,
      month: 0,
      supplyWh: 1,
      demandWh: 100,
      deliveredWhByFuel: {},
      peakDemandW: 100,
      cash: scenario.cash,
      customers: 100,
      netWorth: scenario.cash,
      revenue: 1,
      expensesFuel: 0,
      expensesOM: 0,
      expensesCarbonFee: 0,
      expensesInterest: 0,
      kgco2e: 0,
      interestRate: 0.05,
      inflationRate: 0.02,
    };
    state.monthlyHistory = [
      { ...blackoutMonth, month: 3 },
      { ...blackoutMonth, month: 2 },
      { ...blackoutMonth, month: 1 },
    ];
    expect(
      hasChronicBlackouts([
        { ...blackoutMonth, month: 4, supplyWh: 100 },
        ...state.monthlyHistory,
      ]),
    ).toBe(false);
    state.facilities.forEach((facility) => {
      facility.paused = true;
      facility.currentW = 0;
    });

    playOutOnTheStore(state, 4);
    jest.runOnlyPendingTimers();

    const victory = getStore().getState().ui.victory;
    expect(victory).toEqual(
      expect.objectContaining({
        scenarioId: scenario.id,
        outcome: "fired",
        ranked: true,
      }),
    );
    expect(submitHighscore).toHaveBeenCalledWith(
      expect.objectContaining({
        scenarioId: scenario.id,
        score: victory?.score,
      }),
    );
  });
});

describe("scenario reliability windows", () => {
  it("requires every month in a multi-month event to meet the target", () => {
    const heatwave = SCENARIOS.find((scenario) => scenario.id === 108)!;
    const failedAugust = [
      {
        year: 2026,
        month: 8,
        demandWh: 100,
        supplyWh: 99,
      } as MonthlyHistoryType,
    ];
    expect(scenarioObjectiveFailure(heatwave, failedAugust)).toMatch(
      /2026 heatwave and drought/,
    );

    const afterWindow = [
      {
        year: 2026,
        month: 9,
        demandWh: 100,
        supplyWh: 99,
      } as MonthlyHistoryType,
    ];
    expect(scenarioObjectiveFailure(heatwave, afterWindow)).toBeUndefined();
  });
});

describe("finishing a tutorial", () => {
  const tutorial = TUTORIALS[0];

  beforeEach(() => {
    jest.useFakeTimers();
    // The store is a module singleton, so each case starts from a game that isn't running
    getStore().dispatch(quit());
  });
  afterEach(() => jest.useRealTimers());

  it("pauses at the duration instead of bypassing unfinished objectives", () => {
    window.localStorage.clear();
    let state = createGame({ scenarioId: tutorial.id });
    const initialStep = state.tutorialStep;
    state.speed = "FAST";
    while (state.date.monthsElapsed < tutorial.durationMonths) {
      state = tick(state);
    }
    jest.runOnlyPendingTimers();

    expect(state.speed).toBe("PAUSED");
    expect(state.tutorialStep).toBe(initialStep);
    expect(getStore().getState().ui.dialog.open).toBe(false);
    expect(getPlayedScenarioIds()).not.toContain(tutorial.id);
  });

  it("lets an active capstone own completion at the scenario boundary", () => {
    window.localStorage.clear();
    const capstoneIndex = tutorial.tutorialSteps!.findIndex(
      (step) => step.capstone,
    );
    const state = createGame({ scenarioId: tutorial.id });
    state.tutorialStep = capstoneIndex;

    // Mission 1's one-day capstone and one-month scenario boundary are the same game instant.
    // The capstone success must pause and explain the result instead of racing a second, stale
    // scenario-complete dialog onto the screen.
    playOutOnTheStore(state, tutorial.durationMonths);
    jest.runOnlyPendingTimers();

    const completed = getStore().getState();
    expect(completed.ui.dialog).toEqual(
      expect.objectContaining({
        open: true,
        notCancellable: true,
        actionLabel: "Next tutorial",
        secondaryLabel: "Back to main menu",
      }),
    );
    expect(completed.ui.snackbar.open).toBe(false);
    expect(completed.game.speed).toBe("PAUSED");
    expect(getPlayedScenarioIds()).toContain(tutorial.id);
  });
});
