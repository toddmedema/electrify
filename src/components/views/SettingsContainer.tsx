import type { AppDispatch } from "../../Store";
import { connect } from "react-redux";
import { navigate } from "../../reducers/Card";
import { resume } from "../../reducers/Game";
import { change as changeSettings } from "../../reducers/Settings";
import { snackbarOpen } from "../../reducers/UI";
import {
  describeSave,
  downloadSave,
  readSaveFile,
  resumableSave,
} from "../../SaveFile";
import { AppStateType, UnitSystemType } from "../../Types";
import Settings, { DispatchProps, StateProps } from "./Settings";
import { confirmReplacingSave } from "./StartGame";

const mapStateToProps = (state: AppStateType): StateProps => {
  const resumable = resumableSave();
  return {
    settings: state.settings,
    savedGame: resumable ? describeSave(resumable) : undefined,
  };
};

const mapDispatchToProps = (dispatch: AppDispatch): DispatchProps => {
  return {
    onAudioChange: (v: boolean) => {
      dispatch(changeSettings({ audioEnabled: v }));
    },
    onUnitsChange: (v: UnitSystemType) => {
      dispatch(changeSettings({ units: v }));
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
    onBack: () => {
      dispatch(navigate("MAIN_MENU"));
    },
  };
};

const SettingsContainer = connect(
  mapStateToProps,
  mapDispatchToProps,
)(Settings);

export default SettingsContainer;
