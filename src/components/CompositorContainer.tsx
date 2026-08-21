import { connect } from "react-redux";
import Redux from "redux";
import { delta, quit } from "../reducers/Game";
import { dialogClose, snackbarClose, snackbarOpen } from "../reducers/UI";
import { recordScenarioPlayed } from "../LocalStorage";
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
    scenarioId: state.game.scenarioId,
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
      tutorialSteps: TutorialStepType[] | undefined,
      scenarioId: number
    ): void {
      const steps = tutorialSteps || [];
      const prevStep = steps[newStep - 1];
      if (prevStep && prevStep.onNext) {
        dispatch(prevStep.onNext());
      }
      dispatch(delta({ tutorialStep: newStep }));

      if (newStep < steps.length) {
        return;
      }

      // Finishing the walkthrough is what counts as doing the tutorial - the rest of the
      // scenario is optional practice, and requiring it meant a checkmark cost up to four
      // minutes of watching the sim run
      recordScenarioPlayed(scenarioId);
      dispatch(
        snackbarOpen({
          message: "Walkthrough complete - keep practicing, or move on",
          actionLabel: "Tutorials",
          action: () => dispatch(quit({ toScenarioList: true })),
          open: true,
          timeout: 6000,
        })
      );
    },
    onTutorialEnd(tutorialSteps: TutorialStepType[] | undefined): void {
      // Past the last step, which is how a finished walkthrough is represented too
      dispatch(delta({ tutorialStep: (tutorialSteps || []).length }));
    },
  };
};

const CompositorContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(Compositor);

export default CompositorContainer;
