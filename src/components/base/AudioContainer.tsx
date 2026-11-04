import { connect } from "react-redux";
import { AppStateType } from "../../Types";
import Audio, { StateProps } from "./Audio";
import { musicIntensityForGame } from "../../audio/MusicIntensity";

const NO_EVENTS: NonNullable<AppStateType["game"]["eventLog"]> = [];

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    enabled: state.settings.audioEnabled,
    musicVolume: state.settings.musicVolume,
    soundEffectsVolume: state.settings.soundEffectsVolume,
    musicIntensity: musicIntensityForGame(state.game),
    inGame: state.game.inGame,
    events: state.game.eventLog || NO_EVENTS,
    victoryOpen: Boolean(state.ui.victory),
    dialogOpen: state.ui.dialog.open,
    dialogTitle: state.ui.dialog.title,
  };
};

const AudioContainer = connect(mapStateToProps)(Audio);

export default AudioContainer;
