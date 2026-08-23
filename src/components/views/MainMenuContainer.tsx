import type { AppDispatch } from "../../Store";
import { connect } from "react-redux";
import { AppStateType } from "../../Types";
import { SCENARIOS } from "../../data/Scenarios";
import { navigate } from "../../reducers/Card";
import { resume } from "../../reducers/Game";
import { change as changeSettings } from "../../reducers/Settings";
import { readSave } from "../../SaveGame";
import MainMenu, { DispatchProps, StateProps } from "./MainMenu";

// A save whose scenario no longer exists can't be resumed, so it may as well not be offered
function hasSavedGame(): boolean {
  const save = readSave();
  return !!save && SCENARIOS.some((s) => s.id === save.game.scenarioId);
}

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    audioEnabled: state.settings.audioEnabled,
    hasSavedGame: hasSavedGame(),
    uid: state.user.uid,
  };
};

const mapDispatchToProps = (dispatch: AppDispatch): DispatchProps => {
  return {
    onAudioChange: (v: boolean) => {
      dispatch(changeSettings({ audioEnabled: v }));
    },
    onContinue: () => {
      const save = readSave();
      if (save) {
        // Card sends this to LOADING, which re-reads the CSVs and then dispatches loaded()
        dispatch(resume(save.game));
      }
    },
    onManual: () => {
      dispatch(navigate("MANUAL"));
    },
    onSettings: () => {
      dispatch(navigate("SETTINGS"));
    },
    onStart: () => {
      dispatch(navigate("NEW_GAME"));
    },
  };
};

const MainMenuContainer = connect(
  mapStateToProps,
  mapDispatchToProps,
)(MainMenu);

export default MainMenuContainer;
