import type { AppDispatch } from "../../Store";
import { connect } from "react-redux";
import { AppStateType } from "../../Types";
import { TUTORIALS } from "../../data/Scenarios";
import { getPlayedScenarioIds } from "../../LocalStorage";
import { navigate } from "../../reducers/Card";
import { resume, start } from "../../reducers/Game";
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

export const mapDispatchToProps = (dispatch: AppDispatch): DispatchProps => {
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
      // A brand-new player jumps straight into Mission 1 - "play, don't tell" starts at
      // the menu. The save guard keeps Continue meaningful: someone mid-scenario isn't
      // new, even if they skipped the missions
      const played = getPlayedScenarioIds();
      const anyTutorialDone = TUTORIALS.some(
        (t) => played.indexOf(t.id) !== -1,
      );
      if (!anyTutorialDone && !resumableSave()) {
        dispatch(start(TUTORIALS[0].id));
      } else {
        dispatch(navigate("NEW_GAME"));
      }
    },
  };
};

const MainMenuContainer = connect(
  mapStateToProps,
  mapDispatchToProps,
)(MainMenu);

export default MainMenuContainer;
