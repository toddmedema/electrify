import cardReducer, {
  initialCard,
  navigate,
  navigateBack,
} from "../../reducers/Card";
import {
  loaded,
  start,
  resume,
  startReplay,
  launchRun,
} from "../../reducers/GameActions";
import { UnknownAction } from "@reduxjs/toolkit";
import { TUTORIALS } from "../../data/Scenarios";
import { store } from "../../Store";
import {
  restoreLoadedTutorial,
  restoreTutorialAfterLoading,
} from "./LoadingContainer";

it("restores a capstone's authored pane after rebuilding its scenario", () => {
  const finances = TUTORIALS.find((tutorial) => tutorial.id === 4)!;
  const capstone = finances.tutorialSteps!.findIndex((step) => step.capstone);
  const dispatched: UnknownAction[] = [];

  restoreTutorialAfterLoading(
    ((action: UnknownAction) => {
      dispatched.push(action);
      return action;
    }) as never,
    finances.tutorialSteps!,
    capstone,
  );

  expect(dispatched).toEqual([
    expect.objectContaining({ type: "card/navigate", payload: "PROGRAMS" }),
    expect.objectContaining({
      type: "game/delta",
      payload: { tutorialStep: capstone },
    }),
  ]);
});

it.each([
  { inGame: false, tutorialStep: 3, scenarioId: 0, expectedActions: 0 },
  { inGame: true, tutorialStep: 2, scenarioId: 0, expectedActions: 0 },
  { inGame: true, tutorialStep: 3, scenarioId: 2, expectedActions: 0 },
  { inGame: true, tutorialStep: 3, scenarioId: 0, expectedActions: 2 },
])(
  "only restores the loaded tutorial that requested the callback: %p",
  (current) => {
    const state = store.getState();
    const requested = { ...state.game, scenarioId: 0, tutorialStep: 3 };
    const dispatch = jest.fn();
    restoreLoadedTutorial(
      requested,
      TUTORIALS.find((tutorial) => tutorial.id === 0)!.tutorialSteps!,
    )(
      dispatch,
      () => ({
        ...state,
        card: { ...state.card, name: "FACILITIES" },
        game: { ...requested, ...current },
      }),
      undefined,
    );
    expect(dispatch).toHaveBeenCalledTimes(current.expectedActions);
  },
);

it("a delayed tutorial restoration cannot replace a screen the player opened", () => {
  const state = store.getState();
  const requested = {
    ...state.game,
    inGame: true,
    scenarioId: 1,
    tutorialStep: -1,
  };
  const dispatch = jest.fn();
  restoreLoadedTutorial(
    requested,
    TUTORIALS.find((tutorial) => tutorial.id === 1)!.tutorialSteps!,
  )(
    dispatch,
    () => ({
      ...state,
      game: requested,
      card: { ...state.card, name: "ACHIEVEMENTS" },
    }),
    undefined,
  );
  expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
    { type: "game/delta", payload: { tutorialStep: 0 } },
  ]);
});

it.each([start.type, resume.type, startReplay.type, launchRun.type])(
  "%s finishes loading without taking navigation from the player's newer screen",
  (type) => {
    const loading = cardReducer(initialCard, { type });
    expect(cardReducer(loading, loaded()).name).toBe("FACILITIES");
    const gallery = cardReducer(loading, navigate("ACHIEVEMENTS"));
    expect(cardReducer(gallery, navigateBack()).name).toBe("LOADING");
    const completedGallery = cardReducer(gallery, loaded());
    expect(completedGallery.name).toBe("ACHIEVEMENTS");
    expect(completedGallery.ts).toBe(gallery.ts);
    expect(cardReducer(completedGallery, navigateBack()).name).toBe(
      "FACILITIES",
    );
    const manual = cardReducer(gallery, navigate("MANUAL"));
    const finished = cardReducer(manual, loaded());
    expect(finished.name).toBe("MANUAL");
    expect(finished.ts).toBe(manual.ts);
    const back = cardReducer(finished, navigateBack());
    expect(back.name).toBe("ACHIEVEMENTS");
    expect(cardReducer(back, navigateBack()).name).toBe("FACILITIES");
  },
);
