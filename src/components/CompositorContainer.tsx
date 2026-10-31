import { activeScenario } from "../helpers/GameSelectors";
import type { AppDispatch } from "../Store";
import { connect } from "react-redux";
import { quit } from "../reducers/Game";
import { changeTutorialStep, recordTutorialExited } from "../reducers/Tutorial";
import { dialogClose, snackbarClose } from "../reducers/UI";
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
  } else if (isNavCard(state.card.name)) {
    transition = "nav";
  } else if (
    ["BUILD_GENERATORS", "BUILD_STORAGE", "BUILD_INTERTIES"].indexOf(
      state.card.name,
    ) !== -1
  ) {
    // Build screens share the game panes' fade transition.
    transition = "nav";
  }

  return {
    card: state.card,
    settings: state.settings,
    ui: state.ui,
    transition,
    scenarioId: state.game.scenarioId,
    tutorialStep: state.game.tutorialStep,
    tutorialSteps: (activeScenario(state.game) || ({} as Partial<ScenarioType>))
      .tutorialSteps,
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
    onTutorialEnd(_tutorialSteps: TutorialStepType[] | undefined): void {
      dispatch((_dispatch, getState) => recordTutorialExited(getState().game));
      dispatch(quit());
    },
  };
};

const CompositorContainer = connect(
  mapStateToProps,
  mapDispatchToProps,
)(Compositor);

export default CompositorContainer;
