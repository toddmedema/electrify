import { configureStore, UnknownAction } from "@reduxjs/toolkit";
import * as React from "react";
import { getPlayedScenarioIds } from "../LocalStorage";
import {
  AppStateType,
  CardNameType,
  GameType,
  TutorialActionType,
  TutorialStepType,
} from "../Types";
import {
  DEFAULT_CUSTOM_SCENARIO,
  CUSTOM_SCENARIO_ID,
  getScenario,
  TUTORIALS,
} from "../data/Scenarios";
import cardReducer from "./Card";
import gameReducer, { tutorialCompleteDialog } from "./Game";
import settingsReducer from "./Settings";
import {
  changeTutorialStep,
  restartTutorialAtStep,
  selectTutorialHiddenUi,
  selectTutorialActions,
  tutorialGateMiddleware,
} from "./Tutorial";
import uiReducer from "./UI";
import { tutorialInspectedMapFacility } from "./GameActions";
import { createGame } from "../testing/Simulator";
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
  it("waits for the owned Coal inspection even if the player opens Solar first", () => {
    const mission = getScenario(0)!;
    const store = tutorialStore(mission.tutorialSteps!);
    const game = createGame({ scenarioId: mission.id });
    store.dispatch({
      type: "game/delta",
      payload: { facilities: game.facilities },
    });
    const solar = game.facilities.find((facility) => facility.fuel === "Sun")!;
    const coal = game.facilities.find((facility) => facility.fuel === "Coal")!;
    store.dispatch(tutorialInspectedMapFacility(solar.id));
    expect(store.getState().game.tutorialStep).toBe(0);
    store.dispatch(tutorialInspectedMapFacility(coal.id));
    expect(store.getState().game.tutorialStep).toBe(1);
  });

  it("keeps Storage on its reset disclosure even while time runs", () => {
    const id = 2;
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

    const dispatch = jest.fn(store.dispatch);
    changeTutorialStep(dispatch as never, {
      fromStep: preparation,
      toStep: preparation + 1,
      tutorialSteps: steps,
      scenarioId: id,
      currentCard: store.getState().card.name,
    });
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: "game/quit", payload: undefined },
      { type: "game/start", payload: id },
      { type: "game/delta", payload: { tutorialStep: preparation + 1 } },
    ]);
  });

  it("preserves the chosen price when entering the customer challenge", () => {
    const steps = getScenario(3)!.tutorialSteps!;
    const challenge = steps.findIndex((step) => step.capstone);
    const store = tutorialStore(steps, {
      rate: 0.06,
      tutorialStep: challenge - 1,
    });
    changeTutorialStep(store.dispatch as never, {
      fromStep: challenge - 1,
      toStep: challenge,
      tutorialSteps: steps,
      scenarioId: 3,
      currentCard: "INSIGHTS",
    });
    expect(store.getState().game.tutorialStep).toBe(challenge);
    expect(store.getState().game.dollarsPerkWh).toBe(0.06);
    expect(store.getState().game.speed).toBe("PAUSED");
  });

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
        offerInstall: false,
        secondaryLabel: "Main menu",
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
  it("reopens the project order step when Forecasting is retried", () => {
    const steps = getScenario(5)!.tutorialSteps!;
    const capstone = steps.findIndex((step) => step.capstone);
    const store = tutorialStore(steps, { tutorialStep: capstone });
    store.dispatch({
      type: "game/delta",
      payload: { eventLog: [{ kind: "BLACKOUT" }] },
    });
    expect(store.getState().ui.dialog.action).toBeDefined();
    store
      .getState()
      .ui.dialog.action?.({} as React.MouseEvent<HTMLButtonElement>);
    expect(store.getState().game.tutorialStep).toBe(capstone - 1);
    expect(steps[capstone - 1].action).toContain("Order a plant");
  });
});

describe("navigation steps that teach the game dock", () => {
  it.each([
    [4, "INSIGHTS", "#insightsNav"],
    [3, "PROGRAMS", "#programsNav"],
    [5, "INSIGHTS", "#insightsNav"],
    [112, "AGREEMENTS", "#agreementsNav"],
  ] as const)(
    "keeps mission %s waiting for its %s dock action",
    (id, card, target) => {
      const steps = getScenario(id)!.tutorialSteps!;
      const store = tutorialStore(steps);
      expect(steps[0].target).toBe(target);
      store.dispatch({ type: "test/pane-check" });
      expect(store.getState().game.tutorialStep).toBe(0);
      store.dispatch({ type: "card/navigate", payload: card });
      expect(store.getState().card.name).toBe(card);
      expect(store.getState().game.tutorialStep).toBe(1);
    },
  );
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

describe("selectTutorialActions", () => {
  it("retains taught tools across every authored mission and into free practice", () => {
    let state = initialState([]);
    let taught: TutorialActionType[] = [];
    for (const mission of TUTORIALS) {
      for (let index = 0; index <= mission.tutorialSteps!.length; index++) {
        state = {
          ...state,
          game: { ...state.game, scenarioId: mission.id, tutorialStep: index },
        };
        const actions = selectTutorialActions(state)!;
        expect(actions).toEqual(expect.arrayContaining(taught));
        expect(actions).not.toContain("SCENARIO");
        taught = actions;
      }
    }
    expect(taught).toEqual([
      "FLEET",
      "BUILD_GENERATORS",
      "INSIGHTS",
      "PROGRAMS",
      "EVENTS",
      "AGREEMENTS",
    ]);
  });

  it("does not restrict tools in real scenarios", () => {
    const state = initialState([]);
    state.game.scenarioId = 103;
    expect(selectTutorialActions(state)).toBeUndefined();
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

it.each(TUTORIALS.map((scenario, index) => [scenario.id, index >= 2] as const))(
  "offers installation only from the third tutorial onward (id=%s)",
  (scenarioId, eligible) => {
    expect(
      tutorialCompleteDialog({ scenarioId, title: "Complete" }).payload
        .offerInstall,
    ).toBe(eligible);
  },
);
