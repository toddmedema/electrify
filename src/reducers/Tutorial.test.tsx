import { configureStore, UnknownAction } from "@reduxjs/toolkit";
import * as React from "react";
import { getPlayedScenarioIds } from "../LocalStorage";
import { isPaneLayout } from "../Globals";
import {
  AppStateType,
  CardNameType,
  GameType,
  TutorialStepType,
} from "../Types";
import {
  DEFAULT_CUSTOM_SCENARIO,
  CUSTOM_SCENARIO_ID,
  getScenario,
} from "../data/Scenarios";
import cardReducer from "./Card";
import gameReducer from "./Game";
import settingsReducer from "./Settings";
import {
  recordTutorialExited,
  restartTutorialAtStep,
  selectTutorialHiddenUi,
  tutorialGateMiddleware,
} from "./Tutorial";
import uiReducer from "./UI";
import userReducer from "./User";

// Registered above the imports by babel's jest.mock hoisting, so the scenario step predicates
// (which call isPaneLayout) see the mock. Kept after the imports for import/first.
jest.mock("../Globals", () => ({
  ...jest.requireActual("../Globals"),
  isPaneLayout: jest.fn(),
}));
const mockIsPaneLayout = isPaneLayout as jest.MockedFunction<
  typeof isPaneLayout
>;

function informational(card: "FACILITIES" | "INSIGHTS" = "FACILITIES") {
  return {
    card,
    target: "#information",
    content: <span />,
  } as TutorialStepType;
}

function initialState(
  steps: TutorialStepType[],
  options: {
    rate?: number;
    speed?: GameType["speed"];
    tutorialStep?: number;
  } = {},
): AppStateType {
  const init = { type: "test/init" };
  return {
    card: {
      ...cardReducer(undefined, init),
      name: "FACILITIES",
    },
    game: {
      ...gameReducer(undefined, init),
      scenarioId: CUSTOM_SCENARIO_ID,
      customScenario: {
        ...DEFAULT_CUSTOM_SCENARIO,
        tutorialSteps: steps,
      },
      dollarsPerkWh: options.rate ?? 0.07,
      speed: options.speed ?? "PAUSED",
      tutorialStep: options.tutorialStep || 0,
    },
    settings: settingsReducer(undefined, init),
    ui: uiReducer(undefined, init),
    user: userReducer(undefined, init),
  };
}

function reducer(
  state: AppStateType = initialState([]),
  action: UnknownAction,
): AppStateType {
  if (action.type === "test/satisfy-predicate") {
    return {
      ...state,
      game: { ...state.game, dollarsPerkWh: 0.06 },
    };
  }
  if (action.type === "game/delta") {
    return {
      ...state,
      game: {
        ...state.game,
        ...(action.payload as Partial<AppStateType["game"]>),
      },
    };
  }
  if (action.type === "game/setSpeed") {
    return {
      ...state,
      game: {
        ...state.game,
        speed: action.payload as GameType["speed"],
      },
    };
  }
  if (action.type === "card/navigate") {
    const payload = action.payload as
      string | { name: AppStateType["card"]["name"] };
    return {
      ...state,
      card: {
        ...state.card,
        name:
          typeof payload === "string"
            ? (payload as CardNameType)
            : payload.name,
      },
    };
  }
  if (action.type === "ui/snackbarOpen") {
    return {
      ...state,
      ui: {
        ...state.ui,
        snackbar: action.payload as AppStateType["ui"]["snackbar"],
      },
    };
  }
  if (action.type === "ui/dialogOpen") {
    return {
      ...state,
      ui: uiReducer(state.ui, action),
    };
  }
  return state;
}

function tutorialStore(
  steps: TutorialStepType[],
  options?: {
    rate?: number;
    speed?: GameType["speed"];
    tutorialStep?: number;
  },
) {
  return configureStore({
    reducer,
    preloadedState: initialState(steps, options),
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({ serializableCheck: false }).concat(
        tutorialGateMiddleware,
      ),
  });
}

describe("tutorialGateMiddleware", () => {
  it.each([2, 5])(
    "keeps mission %s on its reset disclosure even while time runs",
    (id) => {
      const steps = getScenario(id)!.tutorialSteps!;
      const preparation = steps.length - 2;
      const store = tutorialStore(steps, {
        speed: "FAST",
        tutorialStep: preparation,
      });
      store.dispatch({ type: "game/setSpeed", payload: "SLOW" });
      expect(store.getState().game.tutorialStep).toBe(preparation);
      expect(store.getState().game.speed).toBe("SLOW");
      expect(steps[preparation].nextLabel).toBe("Start final challenge");
    },
  );

  it("keeps the chosen price and running clock when entering the customer challenge", () => {
    const steps = getScenario(3)!.tutorialSteps!;
    const store = tutorialStore(steps, { rate: 0.069, tutorialStep: 3 });
    store.dispatch({ type: "game/setSpeed", payload: "SLOW" });
    expect(store.getState().game.tutorialStep).toBe(4);
    expect(store.getState().game.dollarsPerkWh).toBe(0.069);
    expect(store.getState().game.speed).toBe("SLOW");
  });
  it.each([
    [2, "BUILD_STORAGE"],
    [112, "BUILD_INTERTIES"],
  ] as const)(
    "gives mission %s a separate highlighted category action",
    (scenarioId, category) => {
      const steps = getScenario(scenarioId)!.tutorialSteps!;
      const store = tutorialStore(steps);
      store.dispatch({ type: "card/navigate", payload: "BUILD_GENERATORS" });
      expect(store.getState().game.tutorialStep).toBe(1);
      expect(store.getState().card.name).toBe("BUILD_GENERATORS");
      expect(steps[1].target).toBe(`#tab-${category}`);
      store.dispatch({ type: "card/navigate", payload: category });
      expect(store.getState().game.tutorialStep).toBe(2);
      expect(store.getState().card.name).toBe(category);
    },
  );

  it("continues an explanation after a successful deed and skips its already-completed gate", () => {
    const satisfied = (state: AppStateType) => state.game.dollarsPerkWh < 0.07;
    const store = tutorialStore([
      { ...informational(), continueOn: satisfied },
      { ...informational(), advanceOn: satisfied },
      informational(),
    ]);
    store.dispatch({ type: "test/rejected-purchase" });
    expect(store.getState().game.tutorialStep).toBe(0);
    store.dispatch({ type: "test/satisfy-predicate" });
    expect(store.getState().game.tutorialStep).toBe(2);
  });

  beforeEach(() => {
    window.localStorage.clear();
  });

  it("advances a predicate gate after the action updates state", () => {
    const steps: TutorialStepType[] = [
      {
        ...informational(),
        advanceOn: (state) => state.game.dollarsPerkWh < 0.07,
      },
      informational("INSIGHTS"),
    ];
    const store = tutorialStore(steps);

    store.dispatch({ type: "test/satisfy-predicate" });

    expect(store.getState().game.tutorialStep).toBe(1);
    expect(store.getState().card.name).toBe("INSIGHTS");
  });

  it("advances an action gate only for a declared action type", () => {
    const steps: TutorialStepType[] = [
      { ...informational(), advanceOnAction: ["test/do-it", "test/also"] },
      informational(),
    ];
    const store = tutorialStore(steps);

    store.dispatch({ type: "test/unrelated" });
    expect(store.getState().game.tutorialStep).toBe(0);

    store.dispatch({ type: "test/do-it" });
    expect(store.getState().game.tutorialStep).toBe(1);
  });

  it("chains through a newly reached predicate gate that is already satisfied", () => {
    const steps: TutorialStepType[] = [
      { ...informational(), advanceOnAction: "test/do-it" },
      {
        ...informational(),
        advanceOn: (state) => state.game.dollarsPerkWh < 0.07,
      },
      informational(),
    ];
    const store = tutorialStore(steps, { rate: 0.06 });

    store.dispatch({ type: "test/do-it" });

    expect(store.getState().game.tutorialStep).toBe(2);
  });

  it("never moves an informational step", () => {
    const store = tutorialStore([informational()]);

    store.dispatch({ type: "test/satisfy-predicate" });

    expect(store.getState().game.tutorialStep).toBe(0);
  });

  it("contains a broken predicate without killing its dispatch", () => {
    const steps: TutorialStepType[] = [
      {
        ...informational(),
        advanceOn: () => {
          throw new Error("broken gate");
        },
      },
    ];
    const store = tutorialStore(steps);

    expect(() => store.dispatch({ type: "test/action" })).not.toThrow();
    expect(store.getState().game.tutorialStep).toBe(0);
  });

  it("records completion and opens a blocking completion dialog", () => {
    const steps: TutorialStepType[] = [
      { ...informational(), advanceOnAction: "test/finish" },
    ];
    const store = tutorialStore(steps);

    store.dispatch({ type: "test/finish" });

    expect(store.getState().game.tutorialStep).toBe(1);
    expect(getPlayedScenarioIds()).toContain(CUSTOM_SCENARIO_ID);
    expect(store.getState().ui.dialog).toEqual(
      expect.objectContaining({
        open: true,
        notCancellable: true,
        secondaryLabel: "Back to main menu",
      }),
    );
  });

  it("completes a capstone from its deterministic state predicate", () => {
    const steps: TutorialStepType[] = [
      {
        ...informational(),
        capstone: {
          success: (state) => state.game.dollarsPerkWh < 0.07,
          successMessage: "Capacity arrived before the peak.",
          failureMessage: "Capacity arrived after the peak.",
        },
      },
    ];
    const store = tutorialStore(steps, { rate: 0.06 });

    store.dispatch({ type: "test/check-capstone" });

    expect(store.getState().game.tutorialStep).toBe(1);
    expect(store.getState().ui.dialog.message).toEqual(
      expect.objectContaining({ type: "div" }),
    );
  });

  it("pauses a failed capstone with consequence feedback and retry controls", () => {
    const steps: TutorialStepType[] = [
      {
        ...informational(),
        capstone: {
          success: () => false,
          failure: (state) => state.game.dollarsPerkWh < 0.07,
          successMessage: "Capacity arrived before the peak.",
          failureMessage: "Construction finished after the forecast peak.",
        },
      },
    ];
    const store = tutorialStore(steps, { rate: 0.06, speed: "FAST" });

    store.dispatch({ type: "test/check-capstone" });

    expect(store.getState().game.tutorialStep).toBe(0);
    expect(store.getState().game.speed).toBe("PAUSED");
    expect(store.getState().ui.dialog).toEqual(
      expect.objectContaining({
        open: true,
        title: "Final challenge needs another try",
        message: "Construction finished after the forecast peak.",
        actionLabel: "Retry final challenge",
        secondaryLabel: "Exit tutorial",
      }),
    );
  });
});

describe("navigation steps that teach the Insights and Events switch", () => {
  afterEach(() => {
    mockIsPaneLayout.mockReset();
  });

  it.each([4, 3])(
    "gates the mission %s opening on the navigation itself",
    (id) => {
      const [opening] = getScenario(id)!.tutorialSteps!;
      expect(opening.target).toBe("#insightsNav");
      // Gated, not a quiet Next that still jumps the player
      expect(opening.advanceOn).toBeDefined();
      expect(opening.continueOn).toBeUndefined();
    },
  );

  it("routes Mission 6 through the player's navigation before each new pane", () => {
    const steps = getScenario(5)!.tutorialSteps!;
    const navSteps = steps
      .map((step, index) => [step, index] as const)
      .filter(([step]) => step.card === undefined);
    expect(navSteps).toHaveLength(3);
    for (const [step, index] of navSteps) {
      const nextCard = steps[index + 1]?.card;
      const name = typeof nextCard === "string" ? nextCard : nextCard?.name;
      const insights = name !== "EVENTS";
      expect(step.advanceOn).toBeDefined();
      expect(step.target).toBe(insights ? "#insightsNav" : "#eventsNav");
      expect(step.desktop?.target).toBe(
        insights ? "#insightsPane" : "#eventsPane",
      );
    }
  });

  it.each([4, 3])(
    "advances the mission %s opening when the player navigates to Insights",
    (id) => {
      mockIsPaneLayout.mockReturnValue(false);
      const steps = getScenario(id)!.tutorialSteps!;
      const store = tutorialStore(steps, { tutorialStep: 0 });
      expect(store.getState().game.tutorialStep).toBe(0);
      store.dispatch({ type: "card/navigate", payload: "INSIGHTS" });
      expect(store.getState().card.name).toBe("INSIGHTS");
      expect(store.getState().game.tutorialStep).toBe(1);
    },
  );

  it("waits for the tap on a narrow layout", () => {
    mockIsPaneLayout.mockReturnValue(false);
    const steps = getScenario(5)!.tutorialSteps!;
    const store = tutorialStore(steps, { tutorialStep: 2 });
    // A dispatch that changes nothing: the step must still be where it was
    store.dispatch({ type: "test/pane-check" });
    expect(store.getState().game.tutorialStep).toBe(2);
  });

  it.each([2, 5, 9] as const)(
    "advances Mission 6's step %d on its own in a pane layout",
    (index) => {
      mockIsPaneLayout.mockReturnValue(true);
      const steps = getScenario(5)!.tutorialSteps!;
      expect(steps[index].card).toBeUndefined();
      const store = tutorialStore(steps, { tutorialStep: index });
      store.dispatch({ type: "test/pane-check" });
      expect(store.getState().game.tutorialStep).toBe(index + 1);
    },
  );

  it.each([2, 5, 9] as const)(
    "advances Mission 6's step %d when the player makes its navigation",
    (index) => {
      mockIsPaneLayout.mockReturnValue(false);
      const steps = getScenario(5)!.tutorialSteps!;
      const step = steps[index];
      const card = step.target === "#eventsNav" ? "EVENTS" : "INSIGHTS";
      const store = tutorialStore(steps, { tutorialStep: index });
      expect(store.getState().game.tutorialStep).toBe(index);
      store.dispatch({ type: "card/navigate", payload: card });
      expect(store.getState().game.tutorialStep).toBe(index + 1);
    },
  );
});

describe("recordTutorialExited", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  const steps = [informational(), informational()];

  it("counts a walkthrough explicitly exited partway as done", () => {
    recordTutorialExited(initialState(steps, { tutorialStep: 1 }).game);
    expect(getPlayedScenarioIds()).toContain(CUSTOM_SCENARIO_ID);
  });

  it("doesn't count a finished or closed walkthrough a second time", () => {
    recordTutorialExited(
      initialState(steps, { tutorialStep: steps.length }).game,
    );
    expect(getPlayedScenarioIds()).toEqual([]);
  });

  it("ignores scenarios without a walkthrough, and replays", () => {
    const game = initialState(steps, { tutorialStep: 0 }).game;
    recordTutorialExited({
      ...game,
      customScenario: { ...DEFAULT_CUSTOM_SCENARIO, tutorialSteps: undefined },
    });
    recordTutorialExited({
      ...game,
      replayPlayback: {} as GameType["replayPlayback"],
    });
    expect(getPlayedScenarioIds()).toEqual([]);
  });
});

describe("restartTutorialAtStep", () => {
  it("rebuilds the authored scenario and preserves the capstone objective", () => {
    const dispatched: UnknownAction[] = [];
    restartTutorialAtStep(
      ((action: UnknownAction) => {
        dispatched.push(action);
        return action;
      }) as never,
      1,
      5,
    );

    expect(dispatched.map((action) => action.type)).toEqual([
      "game/quit",
      "game/start",
      "game/delta",
    ]);
    expect(dispatched[1].payload).toBe(1);
    expect(dispatched[2].payload).toEqual({ tutorialStep: 5 });
  });
});

describe("selectTutorialHiddenUi", () => {
  const bare = {
    ...informational(),
    hideUi: ["nav", "speed"],
  } as TutorialStepType;

  it("hides what the current step asks for, and nothing once the walkthrough ends", () => {
    const state = initialState([bare, informational()]);
    state.game.inGame = true;
    expect(selectTutorialHiddenUi(state)).toEqual(["nav", "speed"]);

    state.game.tutorialStep = 1;
    expect(selectTutorialHiddenUi(state)).toEqual([]);

    state.game.tutorialStep = 2;
    expect(selectTutorialHiddenUi(state)).toEqual([]);
  });

  it("hides nothing outside a game", () => {
    const state = initialState([bare]);
    state.game.inGame = false;
    expect(selectTutorialHiddenUi(state)).toEqual([]);
  });
});
