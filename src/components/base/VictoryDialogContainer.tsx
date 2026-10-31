import { connect } from "react-redux";
import type { AppDispatch } from "../../Store";
import { delta, quit, start } from "../../reducers/Game";
import { runSaveTransition } from "../../SaveSession";
import { snackbarOpen, victoryClose } from "../../reducers/UI";
import { login, logEvent } from "../../Globals";
import { AppStateType, VictoryType } from "../../Types";
import VictoryDialog, { DispatchProps, StateProps } from "./VictoryDialog";

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    victory: state.ui.victory,
    loggedIn: Boolean(state.user.uid),
    uid: state.user.uid,
    displayName: state.user.displayName,
  };
};

export const mapDispatchToProps = (dispatch: AppDispatch): DispatchProps => {
  return {
    onClose: () => {
      dispatch(victoryClose());
    },
    onQuit: () => {
      void runSaveTransition(() => {
        dispatch(victoryClose());
        dispatch(quit({ toScenarioList: true }));
      });
    },
    onRetry: (victory: VictoryType) => {
      void runSaveTransition(() => {
        dispatch(victoryClose());
        dispatch(quit());
        dispatch(delta({ difficulty: victory.difficulty }));
        dispatch(start(victory.scenarioId));
      });
    },
    onLogin: (options) => {
      void login(options);
    },
    onShared: (victory: VictoryType, method: string) => {
      logEvent("score_share", {
        scenarioId: victory.scenarioId,
        difficulty: victory.difficulty,
        score: victory.score,
        method,
      });
      if (method === "clipboard") {
        // A platform share sheet is its own confirmation; a silent clipboard write isn't
        dispatch(
          snackbarOpen({
            message: "Copied! Paste it wherever you like.",
            open: true,
            timeout: VICTORY_TOAST_MS,
            overModal: true,
          }),
        );
      }
    },
    onShareFailed: () => {
      dispatch(
        snackbarOpen({
          message: "Couldn't share that from this browser.",
          open: true,
          timeout: VICTORY_TOAST_MS,
          overModal: true,
        }),
      );
    },
  };
};

const VICTORY_TOAST_MS = 3500;

const VictoryDialogContainer = connect(
  mapStateToProps,
  mapDispatchToProps,
)(VictoryDialog);

export default VictoryDialogContainer;
