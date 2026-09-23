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

  it("writes a public URL for routed cards", () => {
    window.history.replaceState(null, "", "/");
    cardReducer(
      undefined,
      navigate({ name: "NEW_GAME_DETAILS", url: "/?scenario=111" }),
    );
    expect(window.location.search).toBe("?scenario=111");
  });

  it("does not add a browser entry while restoring a route", () => {
    window.history.replaceState(null, "", "/?scenario=111");
    cardReducer(
      undefined,
      navigate({ name: "NEW_GAME_DETAILS", skipBrowserHistory: true }),
    );
    expect(window.location.search).toBe("?scenario=111");
  });
});

it("debounces only the same destination and records accepted navigation time", () => {
  const now = jest.spyOn(Date, "now").mockReturnValue(1000);
  const push = jest.spyOn(window.history, "pushState");
  try {
    const first = cardReducer(undefined, navigate("NEW_GAME"));
    expect(first.ts).toBe(1000);
    expect(cardReducer(first, navigate("NEW_GAME"))).toBe(first);
    expect(push).toHaveBeenCalledTimes(1);
    now.mockReturnValue(2000);
    expect(cardReducer(first, navigate("NEW_GAME")).history).toHaveLength(3);
    const manual = cardReducer(
      first,
      navigate({ name: "MANUAL", entry: "one" }),
    );
    expect(
      cardReducer(manual, navigate({ name: "MANUAL", entry: "two" })).entry,
    ).toBe("two");
    const story = cardReducer(
      first,
      navigate({
        name: "INSIGHTS",
        storyTarget: { card: "INSIGHTS", layer: "FINANCES" },
      }),
    );
    expect(
      cardReducer(
        story,
        navigate({
          name: "INSIGHTS",
          storyTarget: { card: "INSIGHTS", layer: "SUPPLY_DEMAND" },
        }),
      ).storyTarget,
    ).toEqual({ card: "INSIGHTS", layer: "SUPPLY_DEMAND" });
    const route = cardReducer(
      first,
      navigate({ name: "NEW_GAME_DETAILS", url: "/?scenario=106" }),
    );
    expect(
      cardReducer(
        route,
        navigate({ name: "NEW_GAME_DETAILS", url: "/?scenario=107" }),
      ).url,
    ).toBe("/?scenario=107");
  } finally {
    now.mockRestore();
    push.mockRestore();
  }
});
