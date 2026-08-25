import type { AppDispatch } from "../../Store";
import { connect } from "react-redux";
import { AppStateType } from "../../Types";
import { navigate } from "../../reducers/Card";
import { resume } from "../../reducers/Game";
import { change as changeSettings } from "../../reducers/Settings";
import { resumableSave } from "../../SaveFile";
import MainMenu, { DispatchProps, StateProps } from "./MainMenu";

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    audioEnabled: state.settings.audioEnabled,
    hasSavedGame: !!resumableSave(),
    uid: state.user.uid,
  };
};

const mapDispatchToProps = (dispatch: AppDispatch): DispatchProps => {
  return {
    onAudioChange: (v: boolean) => {
      dispatch(changeSettings({ audioEnabled: v }));
    },
    onContinue: () => {
      const resumable = resumableSave();
      if (resumable) {
        // Card sends this to LOADING, which re-reads the CSVs and then dispatches loaded()
        dispatch(resume(resumable.save.game));
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
