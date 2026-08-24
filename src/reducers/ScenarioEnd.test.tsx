import type * as React from "react";
import { produce } from "immer";
import {
  CUSTOM_SCENARIO_ID,
  getNextTutorial,
  SCENARIOS,
  TUTORIALS,
} from "../data/Scenarios";
import { getStore } from "../StoreRegistry";
import { createGame } from "../testing/Simulator";
import { quit, tickState } from "./Game";
import { GameType, ScenarioType } from "../Types";

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

describe("ending a scenario from inside the reducer", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("survives to the end of the term without reading the revoked draft", () => {
    const scenario = customScenario({ durationMonths: 2 });
    let state = createGame({ scenarioId: CUSTOM_SCENARIO_ID, scenario });
    while (state.date.monthsEllapsed < (scenario.durationMonths as number)) {
      state = tick(state);
    }
    expect(() => jest.runOnlyPendingTimers()).not.toThrow();
  });

  it("goes bankrupt without reading the revoked draft", () => {
    // No cash and a marketing budget far past what the fleet earns: it is under within a month
    const scenario = customScenario({ cash: 0, durationMonths: 12 * 20 });
    let state = createGame({
      scenarioId: CUSTOM_SCENARIO_ID,
      scenario,
      monthlyMarketingSpend: 1000000000,
    });
    while (state.date.monthsEllapsed < 2) {
      state = tick(state);
    }
    expect(state.monthlyHistory[0].cash).toBeLessThan(0);
    expect(() => jest.runOnlyPendingTimers()).not.toThrow();
  });
});

describe("finishing a tutorial", () => {
  const tutorial = TUTORIALS[0];
  const next = getNextTutorial(tutorial.id) as ScenarioType;

  beforeEach(() => {
    jest.useFakeTimers();
    // The store is a module singleton, so each case starts from a game that isn't running
    getStore().dispatch(quit());
  });
  afterEach(() => jest.useRealTimers());

  // Runs the tutorial out to its end and hands back the dialog the reducer opened for it
  function finishTutorial() {
    let state = createGame({ scenarioId: tutorial.id });
    while (state.date.monthsEllapsed < tutorial.durationMonths) {
      state = tick(state);
    }
    jest.runOnlyPendingTimers();
    return getStore().getState().ui.dialog;
  }

  it("celebrates rather than showing a score", () => {
    const dialog = finishTutorial();
    expect(dialog.open).toBe(true);
    expect(dialog.title).toContain(tutorial.endTitle as string);
    // Dismissing would leave the player sitting in a scenario that's already over
    expect(dialog.notCancellable).toBe(true);
  });

  it("leads with the next tutorial and keeps the main menu as the way out", () => {
    const dialog = finishTutorial();
    expect(dialog.actionLabel).toBe("Next tutorial");
    expect(dialog.secondaryLabel).toBe("Main menu");
  });

  it("starts the next tutorial without a trip through the scenario list", () => {
    const dialog = finishTutorial();
    (dialog.action as (e: React.MouseEvent<HTMLElement>) => void)(
      {} as React.MouseEvent<HTMLElement>,
    );
    const state = getStore().getState();
    expect(state.game.scenarioId).toBe(next.id);
    // The loading screen is what re-reads the weather and fuel price CSVs for the new location
    expect(state.card.name).toBe("LOADING");
  });

  it("goes back to the title screen from the secondary button", () => {
    const dialog = finishTutorial();
    (dialog.secondaryAction as (e: React.MouseEvent<HTMLElement>) => void)(
      {} as React.MouseEvent<HTMLElement>,
    );
    const state = getStore().getState();
    expect(state.card.name).toBe("MAIN_MENU");
    expect(state.ui.dialog.open).toBe(false);
  });
});
