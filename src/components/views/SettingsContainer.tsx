import type { AppDispatch } from "../../Store";
import { connect } from "react-redux";
import { navigateBack } from "../../reducers/Card";
import { resume } from "../../reducers/Game";
import { change as changeSettings } from "../../reducers/Settings";
import { snackbarOpen } from "../../reducers/UI";
import { delta as userDelta, logout } from "../../reducers/User";
import { login } from "../../Globals";
import {
  describeSave,
  downloadSave,
  readSaveFile,
  resumableSave,
} from "../../SaveFile";
import { AppStateType, ThemeChoiceType, UnitSystemType } from "../../Types";
import Settings, { DispatchProps, StateProps } from "./Settings";
import { confirmReplacingSave } from "./StartGame";

const mapStateToProps = (state: AppStateType): StateProps => {
  const resumable = resumableSave();
  return {
    settings: state.settings,
    savedGame: resumable ? describeSave(resumable) : undefined,
    loggedIn: Boolean(state.user.uid),
    displayName: state.user.displayName,
  };
};

const mapDispatchToProps = (dispatch: AppDispatch): DispatchProps => {
  return {
    onLogin: () => {
      login();
    },
    onLogout: () => {
      dispatch(logout());
    },
    // The dialog itself lives next to the global one in Compositor, so it can also open on first
    // login from whichever card the player happens to be on
    onChangeName: () => {
      dispatch(userDelta({ needsDisplayName: true }));
    },
    onAudioChange: (v: boolean) => {
      dispatch(changeSettings({ audioEnabled: v }));
    },
    onMusicVolumeChange: (v: number) => {
      dispatch(changeSettings({ musicVolume: v }));
    },
    onSoundEffectsVolumeChange: (v: number) => {
      dispatch(changeSettings({ soundEffectsVolume: v }));
    },
    onUnitsChange: (v: UnitSystemType) => {
      dispatch(changeSettings({ units: v }));
    },
    // The palette itself is applied above the store, in App's ThemedApp, which is the only
    // place that can also hear the system changing its mind while the game is open
    onThemeChange: (v: ThemeChoiceType) => {
      dispatch(changeSettings({ theme: v }));
    },
    onExportSave: () => {
      // Read again rather than trusting the render: the button is only enabled when there's a
      // save, but nothing stops another tab clearing it in between
      const resumable = resumableSave();
      if (!resumable) {
        dispatch(snackbarOpen("There's no saved game to export."));
        return;
      }
      downloadSave(resumable);
    },
    onImportSave: (file: File) => {
      readSaveFile(file).then(({ save, error }) => {
        if (!save) {
          dispatch(snackbarOpen(error || "That file isn't a save game."));
          return;
        }
        confirmReplacingSave(
          dispatch,
          { title: "Load this save?", actionLabel: "Load game" },
          // Card sends this to LOADING, which re-reads the CSVs and then dispatches loaded().
          // The autosave picks the imported game up from there, so it survives a reload
          () => dispatch(resume(save.game)),
        );
      });
    },
    // Mirrors Manual: Options can now be reached mid-game too, so back has to return wherever
    // the player came from rather than always dropping them at the main menu
    onBack: () => {
      dispatch(navigateBack());
    },
  };
};

const SettingsContainer = connect(
  mapStateToProps,
  mapDispatchToProps,
)(Settings);

export default SettingsContainer;
