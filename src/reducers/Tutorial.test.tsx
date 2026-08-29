import { configureStore, UnknownAction } from "@reduxjs/toolkit";
import * as React from "react";
import { getPlayedScenarioIds } from "../LocalStorage";
import {
  AppStateType,
  CardNameType,
  GameType,
  TutorialStepType,
} from "../Types";
import { DEFAULT_CUSTOM_SCENARIO, CUSTOM_SCENARIO_ID } from "../data/Scenarios";
import cardReducer from "./Card";
import gameReducer from "./Game";
import settingsReducer from "./Settings";
import { restartTutorialAtStep, tutorialGateMiddleware } from "./Tutorial";
import uiReducer from "./UI";
import userReducer from "./User";

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
    expect(store.getState().ui.snackbar.message).toBe(
      "Capacity arrived before the peak.",
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
        title: "Capstone needs another try",
        message: "Construction finished after the forecast peak.",
        actionLabel: "Retry capstone",
        secondaryLabel: "Exit tutorial",
      }),
    );
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
