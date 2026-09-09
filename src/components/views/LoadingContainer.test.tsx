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
    expect.objectContaining({ type: "card/navigate", payload: "INSIGHTS" }),
    expect.objectContaining({
      type: "game/delta",
      payload: { tutorialStep: capstone },
    }),
  ]);
});

it.each([
  { inGame: false, tutorialStep: 4, scenarioId: 0, expectedActions: 0 },
  { inGame: true, tutorialStep: 3, scenarioId: 0, expectedActions: 0 },
  { inGame: true, tutorialStep: 4, scenarioId: 2, expectedActions: 0 },
  { inGame: true, tutorialStep: 4, scenarioId: 0, expectedActions: 2 },
])(
  "only restores the loaded tutorial that requested the callback: %p",
  (current) => {
    const state = store.getState();
    const requested = { ...state.game, scenarioId: 0, tutorialStep: 4 };
    const dispatch = jest.fn();
    restoreLoadedTutorial(
      requested,
      TUTORIALS.find((tutorial) => tutorial.id === 0)!.tutorialSteps!,
    )(
      dispatch,
      () => ({ ...state, game: { ...requested, ...current } }),
      undefined,
    );
    expect(dispatch).toHaveBeenCalledTimes(current.expectedActions);
  },
);
