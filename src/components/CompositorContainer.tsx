import { connect } from "react-redux";
import Redux from "redux";
import { delta, quit } from "../reducers/Game";
import { dialogClose, snackbarClose, snackbarOpen } from "../reducers/UI";
import { recordScenarioPlayed } from "../LocalStorage";
import { SCENARIOS } from "../data/Scenarios";
import { navigate } from "../reducers/Card";
import { AppStateType, TransitionClassType, TutorialStepType } from "../Types";
import Compositor, {
  DispatchProps,
  isNavCard,
  StateProps,
  TutorialStepChangeType,
} from "./Compositor";

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
  dispatch: Redux.Dispatch<any>,
): DispatchProps => {
  return {
    closeDialog(): void {
      dispatch(dialogClose());
    },
    closeSnackbar(): void {
      dispatch(snackbarClose());
    },
    onTutorialStep({
      fromStep,
      toStep,
      tutorialSteps,
      scenarioId,
      currentCard,
    }: TutorialStepChangeType): void {
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
          actionLabel: "Tutorials",
          action: () => dispatch(quit({ toScenarioList: true })),
          open: true,
          timeout: 6000,
        }),
      );
    },
    onTutorialEnd(tutorialSteps: TutorialStepType[] | undefined): void {
      // Past the last step, which is how a finished walkthrough is represented too
      dispatch(delta({ tutorialStep: (tutorialSteps || []).length }));
      // On its own, closing just makes the overlay vanish and leaves the player sitting in
      // a paused scenario with no idea what happened - so say so, and offer the way out
      dispatch(
        snackbarOpen({
          message:
            "Walkthrough closed - keep playing, or pick another tutorial",
          actionLabel: "Tutorials",
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
