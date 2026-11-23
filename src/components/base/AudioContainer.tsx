import type { AppDispatch } from "../../Store";
import { connect } from "react-redux";
import { change as changeSettings } from "../../reducers/Settings";
import { snackbarOpen } from "../../reducers/UI";
import { AppStateType } from "../../Types";
import Audio, { DispatchProps, StateProps } from "./Audio";
import { musicIntensityForGame } from "../../audio/MusicIntensity";
import {
  couchPlatformMatch,
  subscribeCouchPlatform,
} from "../../couch/Platform";
import { useSyncExternalStore } from "react";

const NO_EVENTS: NonNullable<AppStateType["game"]["eventLog"]> = [];

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    enabled: state.settings.audioEnabled,
    musicVolume: state.settings.musicVolume,
    soundEffectsVolume: state.settings.soundEffectsVolume,
    musicIntensity: musicIntensityForGame(state.game),
    musicRunId: state.game.inGame
      ? `${state.game.multiplayer ? "online" : "solo"}:${state.ui.evidenceRunId ?? 0}`
      : undefined,
    inGame: state.game.inGame,
    events: state.game.eventLog || NO_EVENTS,
    victoryOpen: Boolean(state.ui.victory),
    dialogOpen: state.ui.dialog.open,
    dialogTitle: state.ui.dialog.title,
  };
};

const mapDispatchToProps = (dispatch: AppDispatch): DispatchProps => ({
  disableAudio: () => {
    dispatch(snackbarOpen("Audio not supported on this device; disabling."));
    dispatch(changeSettings({ audioEnabled: false }));
  },
});

/** Couch seats do not play music. The shell follows its authoritative match. */
function DesktopAudio(props: StateProps & DispatchProps) {
  const match = useSyncExternalStore(
    subscribeCouchPlatform,
    couchPlatformMatch,
  );
  return match?.game ? (
    <Audio
      {...props}
      musicRunId={`couch:${match.token}`}
      musicIntensity={musicIntensityForGame(match.game)}
    />
  ) : (
    <Audio {...props} />
  );
}

const AudioContainer = connect(
  mapStateToProps,
  mapDispatchToProps,
)(process.env.REACT_APP_DESKTOP === "true" ? DesktopAudio : Audio);

export default AudioContainer;
