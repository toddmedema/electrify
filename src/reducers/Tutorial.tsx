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
import { delta, quit, setSpeed, start } from "./Game";
import { dialogOpen, snackbarOpen } from "./UI";

/**
 * Restores a capstone's authored state while keeping the player on the capstone objective.
 *
 * Tutorial scenarios are not autosaved. Reusing their normal start path is consequently both
 * faster and safer than maintaining a second partial snapshot format: cash, clock, fleet, event
 * log and all derived forecasts are rebuilt together, and a scenario seed makes the rebuild
 * deterministic. LoadingContainer preserves the requested step instead of reopening step zero.
 * Capstones that build directly on guided progress do not use this path on entry.
 */
export function restartTutorialAtStep(
  dispatch: AppDispatch,
  scenarioId: number,
  tutorialStep: number,
): void {
  dispatch(quit());
  dispatch(start(scenarioId));
  dispatch(delta({ tutorialStep }));
}

// Moves a live walkthrough between two steps, whether a HUD button or a satisfied gate
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

  const entering = steps[toStep];
  // Steps declare the card their target lives on, and every step change navigates there
  // regardless of direction. Otherwise Back leaves the player on whatever card the
  // forward step navigated to, where the objective's target treatment cannot find its control
  const destination = entering?.card;
  if (destination) {
    const name =
      typeof destination === "string" ? destination : destination.name;
    if (name !== currentCard) {
      dispatch(navigate(destination));
    }
  }

  if (
    toStep > fromStep &&
    entering?.capstone &&
    !entering.capstone.preserveProgress
  ) {
    restartTutorialAtStep(dispatch, scenarioId, toStep);
    return;
  }

  // A capstone is the mission's proof point. Freeze the authored consequence at success so the
  // player can read it instead of letting the scenario clock race on to its separate end dialog.
  if (toStep > fromStep && leaving?.capstone) {
    dispatch(setSpeed("PAUSED"));
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
      message:
        leaving?.capstone?.successMessage ||
        "Walkthrough complete - keep practicing, or move on",
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
        let capstoneFailed = false;
        try {
          byState = !!(
            (step.advanceOn && step.advanceOn(state)) ||
            (step.capstone && step.capstone.success(state))
          );
          capstoneFailed = !!(
            step.capstone?.failure && step.capstone.failure(state)
          );
        } catch {
          // A broken gate must not kill the dispatch it rides on
        }
        if (!byState && capstoneFailed && step.capstone) {
          const { failureMessage } = step.capstone;
          // Freeze the failed state before presenting it. Otherwise a fast clock can keep
          // mutating the consequence behind the modal while the player is deciding what to do.
          (api.dispatch as AppDispatch)(setSpeed("PAUSED"));
          api.dispatch(
            dialogOpen({
              title: "Capstone needs another try",
              message: failureMessage,
              open: true,
              notCancellable: true,
              secondaryLabel: "Exit tutorial",
              secondaryAction: () =>
                (api.dispatch as AppDispatch)(quit({ toScenarioList: true })),
              actionLabel: "Retry capstone",
              action: () =>
                restartTutorialAtStep(
                  api.dispatch as AppDispatch,
                  state.game.scenarioId,
                  stepIndex,
                ),
            }),
          );
          break;
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
