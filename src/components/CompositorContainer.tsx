import type { AppDispatch } from "../Store";
import { connect } from "react-redux";
import { delta, quit } from "../reducers/Game";
import { changeTutorialStep } from "../reducers/Tutorial";
import { dialogClose, snackbarClose, snackbarOpen } from "../reducers/UI";
import { getScenario } from "../data/Scenarios";
import {
  AppStateType,
  ScenarioType,
  TransitionClassType,
  TutorialStepChangeType,
  TutorialStepType,
} from "../Types";
import Compositor, { DispatchProps, isNavCard, StateProps } from "./Compositor";

const mapStateToProps = (state: AppStateType): StateProps => {
  let transition: TransitionClassType = "next";
  if (state === undefined || Object.keys(state).length === 0) {
    transition = "instant";
  } else if (state.card.toPrevious) {
    transition = "prev";
  } else if (state.card.name === "MAIN_MENU") {
    transition = "instant";
  } else if (isNavCard(state.card.name)) {
    transition = "nav";
  } else if (
    ["BUILD_GENERATORS", "BUILD_STORAGE"].indexOf(state.card.name) !== -1
  ) {
    // modals that should fade in / out instead of slide
    transition = "nav";
  }

  return {
    card: state.card,
    settings: state.settings,
    ui: state.ui,
    transition,
    scenarioId: state.game.scenarioId,
    tutorialStep: state.game.tutorialStep,
    tutorialSteps: (
      getScenario(state.game.scenarioId, state.game.customScenario) ||
      ({} as Partial<ScenarioType>)
    ).tutorialSteps,
  };
};

export const mapDispatchToProps = (dispatch: AppDispatch): DispatchProps => {
  return {
    closeDialog(): void {
      dispatch(dialogClose());
    },
    closeSnackbar(): void {
      dispatch(snackbarClose());
    },
    onTutorialStep(change: TutorialStepChangeType): void {
      // Shared with the gate middleware, so a tooltip button and a satisfied gate fire
      // identical side effects
      changeTutorialStep(dispatch, change);
    },
    onTutorialEnd(tutorialSteps: TutorialStepType[] | undefined): void {
      // Past the last step, which is how a finished walkthrough is represented too
      dispatch(delta({ tutorialStep: (tutorialSteps || []).length }));
      // On its own, closing just makes the overlay vanish and leaves the player sitting in
      // a paused scenario with no idea what happened - so say so, and offer the way out
      dispatch(
        snackbarOpen({
          message: "Walkthrough closed - keep playing, or pick another mission",
          actionLabel: "Missions",
          action: () => dispatch(quit({ toScenarioList: true })),
          open: true,
          timeout: 6000,
        }),
      );
    },
  };
};

const CompositorContainer = connect(
  mapStateToProps,
  mapDispatchToProps,
)(Compositor);

export default CompositorContainer;
