import { connect } from "react-redux";
import type { AppDispatch } from "../../Store";
import { quit } from "../../reducers/Game";
import { snackbarOpen, victoryClose } from "../../reducers/UI";
import { login, logEvent } from "../../Globals";
import { AppStateType, VictoryType } from "../../Types";
import VictoryDialog, { DispatchProps, StateProps } from "./VictoryDialog";

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    victory: state.ui.victory,
    loggedIn: Boolean(state.user.uid),
  };
};

const mapDispatchToProps = (dispatch: AppDispatch): DispatchProps => {
  return {
    onClose: () => {
      dispatch(victoryClose());
    },
    onQuit: () => {
      dispatch(victoryClose());
      dispatch(quit({ toScenarioList: true }));
    },
    onLogin: () => {
      login();
    },
    onShared: (victory: VictoryType, method: string) => {
      // The share button is the lever this whole feature is pulling, so measure whether anyone
      // actually pulls it
      logEvent("score_share", {
        scenarioId: victory.scenarioId,
        difficulty: victory.difficulty,
        score: victory.score,
        method,
      });
      if (method === "clipboard") {
        // A platform share sheet is its own confirmation; a silent clipboard write isn't
        dispatch(snackbarOpen("Copied! Paste it wherever you like."));
      }
    },
    onShareFailed: () => {
      dispatch(snackbarOpen("Couldn't share that from this browser."));
    },
  };
};

const VictoryDialogContainer = connect(
  mapStateToProps,
  mapDispatchToProps,
)(VictoryDialog);

export default VictoryDialogContainer;
