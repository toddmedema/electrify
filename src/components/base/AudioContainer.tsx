import type { AppDispatch } from "../../Store";
import { connect } from "react-redux";
import { change as changeSettings } from "../../reducers/Settings";
import { snackbarOpen } from "../../reducers/UI";
import { AppStateType } from "../../Types";
import Audio, { DispatchProps, StateProps } from "./Audio";

const NO_EVENTS: NonNullable<AppStateType["game"]["eventLog"]> = [];

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    enabled: state.settings.audioEnabled,
    musicVolume: state.settings.musicVolume,
    soundEffectsVolume: state.settings.soundEffectsVolume,
    inGame: state.game.inGame,
    events: state.game.eventLog || NO_EVENTS,
    victoryOpen: Boolean(state.ui.victory),
    dialogOpen: state.ui.dialog.open,
    dialogTitle: state.ui.dialog.title,
  };
};

const mapDispatchToProps = (dispatch: AppDispatch): DispatchProps => {
  return {
    disableAudio(): void {
      dispatch(snackbarOpen("Audio not supported on this device; disabling."));
      dispatch(changeSettings({ audioEnabled: false }));
    },
  };
};

const AudioContainer = connect(mapStateToProps, mapDispatchToProps)(Audio);

export default AudioContainer;
