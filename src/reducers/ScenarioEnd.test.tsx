import { produce } from "immer";
import { CUSTOM_SCENARIO_ID, SCENARIOS } from "../data/Scenarios";
import { createGame } from "../testing/Simulator";
import { tickState } from "./Game";
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
