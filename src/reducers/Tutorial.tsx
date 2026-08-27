import type { Middleware } from "@reduxjs/toolkit";
import { recordScenarioPlayed } from "../LocalStorage";
import { getScenario } from "../data/Scenarios";
import type { AppDispatch } from "../Store";
import {
  AppStateType,
  TutorialStepChangeType,
  TutorialStepType,
  isGatedStep,
} from "../Types";
import { navigate } from "./Card";
import { delta, quit } from "./Game";
import { snackbarOpen } from "./UI";

// Moves a live walkthrough between two steps, whether a tooltip button or a satisfied gate
// asked for it - both paths need the same side effects, in the same order
export function changeTutorialStep(
  dispatch: AppDispatch,
  {
    fromStep,
    toStep,
    tutorialSteps,
    scenarioId,
    currentCard,
  }: TutorialStepChangeType,
): void {
  const steps = tutorialSteps || [];

  // Only leaving a step forwards runs its one-way side effects - Back has no way to undo
  // them, and replaying the previous step's would fire an effect nobody triggered
  const leaving = toStep > fromStep ? steps[fromStep] : undefined;
  if (leaving && leaving.onNext) {
    dispatch(leaving.onNext());
  }

  // Steps declare the card their target lives on, and every step change navigates there
  // regardless of direction. Otherwise Back leaves the player on whatever card the
  // forward step navigated to, where Joyride can't find the target and shows no tooltip
  const destination = steps[toStep] && steps[toStep].card;
  if (destination) {
    const name =
      typeof destination === "string" ? destination : destination.name;
    if (name !== currentCard) {
      dispatch(navigate(destination));
    }
  }

  dispatch(delta({ tutorialStep: toStep }));

  if (toStep < steps.length) {
    return;
  }

  // Finishing the walkthrough is what counts as doing the tutorial - the rest of the
  // scenario is optional practice, and requiring it meant a checkmark cost up to four
  // minutes of watching the sim run
  recordScenarioPlayed(scenarioId);
  dispatch(
    snackbarOpen({
      message: "Walkthrough complete - keep practicing, or move on",
      actionLabel: "Missions",
      action: () => dispatch(quit({ toScenarioList: true })),
      open: true,
      timeout: 6000,
    }),
  );
}

function matchesActionGate(
  step: TutorialStepType,
  actionType: string | undefined,
): boolean {
  if (step.advanceOnAction === undefined || actionType === undefined) {
    return false;
  }
  return ([] as string[]).concat(step.advanceOnAction).includes(actionType);
}

// True while a gate-driven advance is mid-flight. changeTutorialStep's own dispatches
// (onNext, navigate, delta, snackbar) re-enter this middleware before tutorialStep has
// moved off the satisfied step, which would re-advance the same step without end - the
// loop below does the chaining deliberately instead.
let advancing = false;

// The "play, don't tell" engine: after every dispatch, a gated step advances the moment
// its deed is done. A middleware rather than the tick loop because deeds happen while
// paused too (buying, re-ordering), and rather than store.subscribe because subscribers
// never see action types, which advanceOnAction needs.
export const tutorialGateMiddleware: Middleware =
  (api) => (next) => (action) => {
    const result = next(action);
    if (advancing) {
      return result;
    }
    const actionType =
      typeof action === "object" && action !== null && "type" in action
        ? String((action as { type: unknown }).type)
        : undefined;
    advancing = true;
    try {
      // The dispatched action can only satisfy the step it landed on; steps reached by
      // chaining advance solely on state predicates that are already true - a player who
      // did a deed early skips its step the moment they arrive on it
      let freshAction = true;
      for (;;) {
        const state = api.getState() as AppStateType;
        const stepIndex = state.game.tutorialStep;
        if (stepIndex < 0) {
          break;
        }
        const scenario = getScenario(
          state.game.scenarioId,
          state.game.customScenario,
        );
        const steps = scenario && scenario.tutorialSteps;
        const step = steps && steps[stepIndex];
        if (!step || !isGatedStep(step)) {
          break;
        }
        const byAction = freshAction && matchesActionGate(step, actionType);
        let byState = false;
        try {
          byState = !!(step.advanceOn && step.advanceOn(state));
        } catch {
          // A broken gate must not kill the dispatch it rides on
        }
        if (!byAction && !byState) {
          break;
        }
        changeTutorialStep(api.dispatch as AppDispatch, {
          fromStep: stepIndex,
          toStep: stepIndex + 1,
          tutorialSteps: steps,
          scenarioId: state.game.scenarioId,
          currentCard: state.card.name,
        });
        freshAction = false;
        // Bail rather than spin if the step somehow didn't move
        if ((api.getState() as AppStateType).game.tutorialStep === stepIndex) {
          break;
        }
      }
    } finally {
      advancing = false;
    }
    return result;
  };
