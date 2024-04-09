import { connect } from "react-redux";
import Redux from "redux";
import { change as changeSettings } from "../../reducers/Settings";
import { snackbarOpen } from "../../reducers/UI";
import { AppStateType } from "../../Types";
import Audio, { DispatchProps, StateProps } from "./Audio";

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    enabled: state.settings.audioEnabled,
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    disableAudio(): void {
      dispatch(snackbarOpen("Audio not supported on this device; disabling."));
      dispatch(changeSettings({ audioEnabled: false }));
    },
  };
};

const AudioContainer = connect(mapStateToProps, mapDispatchToProps)(Audio);

export default AudioContainer;
