import { multiplayerSnapshot } from "./GameActions";
import type { GameType } from "../Types";
import cardReducer, {
  manualTrailCleared,
  navigate,
  navigateBack,
  navigationDestinationMiddleware,
} from "./Card";
import { quit } from "./GameActions";

describe("card reducer", () => {
  it("retraces links between manual entries before leaving the manual", () => {
    const menu = cardReducer(undefined, navigate("MAIN_MENU"));
    const manual = cardReducer(
      menu,
      navigate({ name: "MANUAL", entry: "Score" }),
    );
    const linked = cardReducer(
      manual,
      navigate({ name: "MANUAL", entry: "Blackouts", fromEntry: "Score" }),
    );
    const deeper = cardReducer(
      linked,
      navigate({ name: "MANUAL", entry: "Interties", fromEntry: "Blackouts" }),
    );
    // A link is a step within the manual, not another visit to it
    expect(deeper.history).toEqual(manual.history);
    expect(deeper.manualTrail).toEqual(["Blackouts", "Score"]);

    const back = cardReducer(deeper, navigateBack());
    expect(back).toMatchObject({ name: "MANUAL", entry: "Blackouts" });
    const backAgain = cardReducer(back, navigateBack());
    expect(backAgain).toMatchObject({ name: "MANUAL", entry: "Score" });
    expect(cardReducer(backAgain, navigateBack()).name).toBe("MAIN_MENU");
  });

  it("leaves the manual from its header however many links deep", () => {
    const manual = cardReducer(
      cardReducer(undefined, navigate("MAIN_MENU")),
      navigate({ name: "MANUAL", entry: "Score" }),
    );
    const linked = cardReducer(
      manual,
      navigate({ name: "MANUAL", entry: "Blackouts", fromEntry: "Score" }),
    );
    const left = cardReducer(
      cardReducer(linked, manualTrailCleared()),
      navigateBack(),
    );
    expect(left.name).toBe("MAIN_MENU");
    // A later visit starts without the old trail
    const revisit = cardReducer(left, navigate("MANUAL"));
    expect(revisit.manualTrail).toBeUndefined();
  });

  it("tells the game a manual step back stays in the manual", () => {
    const card = cardReducer(
      cardReducer(undefined, navigate({ name: "MANUAL", entry: "Score" })),
      navigate({ name: "MANUAL", entry: "Blackouts", fromEntry: "Score" }),
    );
    const next = jest.fn();
    navigationDestinationMiddleware({
      getState: () => ({ card }),
    } as never)(next)(navigateBack());
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ payload: "MANUAL" }),
    );
  });

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

  it("opens a data-center guide link on its setup, with the title screen one step back", () => {
    window.history.replaceState(null, "", "/?dataCenters=1");
    const state = cardReducer(undefined, { type: "@@INIT" });
    expect(state.name).toBe("DATA_CENTER_SETUP");
    expect(state.ts).toBe(0);
    expect(cardReducer(state, navigateBack()).name).toBe("MAIN_MENU");
    // Quitting a run started from there still lands on the title screen
    expect(cardReducer(state, quit()).name).toBe("MAIN_MENU");
    window.history.replaceState(null, "", "/");
    expect(cardReducer(undefined, { type: "@@INIT" }).name).toBe("MAIN_MENU");
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

test("a shared mod launch leaves its selection preview for the grid", () => {
  const selected = cardReducer(undefined, navigate("MODS"));
  const launched = cardReducer(selected, multiplayerSnapshot({} as GameType));
  expect(launched.name).toBe("FACILITIES");
  expect(launched.history).toEqual(["FACILITIES", "MAIN_MENU"]);
  const reading = cardReducer(launched, navigate("MANUAL"));
  expect(cardReducer(reading, multiplayerSnapshot({} as GameType)).name).toBe(
    "MANUAL",
  );
});
