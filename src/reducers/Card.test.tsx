import cardReducer, { navigate, navigateBack } from "./Card";
import { quit } from "./GameActions";

describe("card reducer", () => {
  it("goes to the custom game screen and back to the scenario list", () => {
    const list = cardReducer(undefined, navigate("NEW_GAME"));
    const custom = cardReducer(list, navigate("CUSTOM_GAME"));
    expect(custom.name).toBe("CUSTOM_GAME");
    expect(cardReducer(custom, navigateBack()).name).toBe("NEW_GAME");
  });

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
