import { configureStore, UnknownAction } from "@reduxjs/toolkit";
import * as React from "react";
import { getPlayedScenarioIds } from "../LocalStorage";
import { AppStateType, CardNameType, TutorialStepType } from "../Types";
import { DEFAULT_CUSTOM_SCENARIO, CUSTOM_SCENARIO_ID } from "../data/Scenarios";
import cardReducer from "./Card";
import gameReducer from "./Game";
import settingsReducer from "./Settings";
import { tutorialGateMiddleware } from "./Tutorial";
import uiReducer from "./UI";
import userReducer from "./User";

function informational(card: "FACILITIES" | "FINANCES" = "FACILITIES") {
  return {
    card,
    target: "#information",
    content: <span />,
  } as TutorialStepType;
}

function initialState(
  steps: TutorialStepType[],
  options: { marketingSpend?: number; tutorialStep?: number } = {},
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
      monthlyMarketingSpend: options.marketingSpend || 0,
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
      game: { ...state.game, monthlyMarketingSpend: 1 },
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
  return state;
}

function tutorialStore(
  steps: TutorialStepType[],
  options?: { marketingSpend?: number; tutorialStep?: number },
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
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("advances a predicate gate after the action updates state", () => {
    const steps: TutorialStepType[] = [
      {
        ...informational(),
        advanceOn: (state) => state.game.monthlyMarketingSpend > 0,
      },
      informational("FINANCES"),
    ];
    const store = tutorialStore(steps);

    store.dispatch({ type: "test/satisfy-predicate" });

    expect(store.getState().game.tutorialStep).toBe(1);
    expect(store.getState().card.name).toBe("FINANCES");
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
        advanceOn: (state) => state.game.monthlyMarketingSpend > 0,
      },
      informational(),
    ];
    const store = tutorialStore(steps, { marketingSpend: 1 });

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

  it("records completion and opens the completion snackbar", () => {
    const steps: TutorialStepType[] = [
      { ...informational(), advanceOnAction: "test/finish" },
    ];
    const store = tutorialStore(steps);

    store.dispatch({ type: "test/finish" });

    expect(store.getState().game.tutorialStep).toBe(1);
    expect(getPlayedScenarioIds()).toContain(CUSTOM_SCENARIO_ID);
    expect(store.getState().ui.snackbar).toEqual(
      expect.objectContaining({ open: true, actionLabel: "Missions" }),
    );
  });
});
