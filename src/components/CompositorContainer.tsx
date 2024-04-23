import { connect } from "react-redux";
import Redux from "redux";
import { delta } from "../reducers/Game";
import { dialogClose, snackbarClose } from "../reducers/UI";
import { SCENARIOS } from "../data/Scenarios";
import { AppStateType, TransitionClassType, TutorialStepType } from "../Types";
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
    tutorialStep: state.game.tutorialStep,
    tutorialSteps: (SCENARIOS.find((s) => s.id === state.game.scenarioId) || {})
      .tutorialSteps,
  };
};

export const mapDispatchToProps = (
  dispatch: Redux.Dispatch<any>
): DispatchProps => {
  return {
    closeDialog(): void {
      dispatch(dialogClose());
    },
    closeSnackbar(): void {
      dispatch(snackbarClose());
    },
    onTutorialStep(
      newStep: number,
      tutorialSteps: TutorialStepType[] | undefined
    ): void {
      const prevStep = (tutorialSteps || [])[newStep - 1];
      if (prevStep && prevStep.onNext) {
        dispatch(prevStep.onNext());
      }
      dispatch(delta({ tutorialStep: newStep }));
    },
  };
};

const CompositorContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(Compositor);

export default CompositorContainer;
