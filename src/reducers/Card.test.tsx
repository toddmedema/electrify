import cardReducer from "./Card";
import { quit } from "./GameActions";

describe("card reducer", () => {
  it("returns to the title screen on a plain quit", () => {
    const state = cardReducer(undefined, quit());
    expect(state.name).toBe("MAIN_MENU");
  });

  it("returns to the scenario list when a scenario ends", () => {
    const state = cardReducer(undefined, quit({ toScenarioList: true }));
    expect(state.name).toBe("NEW_GAME");
    // Back from the scenario list should still reach the title screen
    expect(state.history).toEqual(["NEW_GAME", "MAIN_MENU"]);
  });
});
