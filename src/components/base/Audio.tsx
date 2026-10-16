import {
  loadAudioFiles,
  pause,
  playSoundEffect,
  resume,
  setMusicInGame,
  setMusicVolume,
  setSoundEffectsVolume,
  state as audioState,
} from "../../data/Audio";
import {
  soundEffectsForUpdate,
  SoundEventSnapshot,
} from "../../audio/SoundEvents";
import { INIT_DELAY } from "../../Constants";
import * as React from "react";

export interface StateProps extends SoundEventSnapshot {
  enabled?: boolean;
  musicVolume: number;
  soundEffectsVolume: number;
  musicIntensity: number;
}

export interface DispatchProps {
  disableAudio: () => void;
}

interface Props extends StateProps, DispatchProps {}

export default class Audio extends React.Component<Props, {}> {
  private loadTimer: ReturnType<typeof setTimeout> | undefined;

  componentDidMount() {
    setMusicInGame(this.props.inGame, this.props.musicIntensity);
    // Load after a timeout so as not to overload the device.
    this.loadTimer = setTimeout(() => {
      if (!this.props.enabled) {
        return;
      }
      this.handleEnableState(this.props.enabled);
    }, INIT_DELAY.LOAD_AUDIO_MILLIS);
  }

  componentWillUnmount() {
    clearTimeout(this.loadTimer);
    pause();
  }

  private handleEnableState(enabled?: boolean) {
    if (!enabled) {
      pause();
      return;
    }
    if (audioState.loaded === "UNLOADED") {
      resume();
      loadAudioFiles(this.props.musicVolume, this.props.soundEffectsVolume);
    } else if (audioState.loaded === "ERROR") {
      this.props.disableAudio();
    } else {
      setMusicVolume(this.props.musicVolume);
      setSoundEffectsVolume(this.props.soundEffectsVolume);
      resume();
    }
  }

  componentDidUpdate(prevProps: StateProps) {
    if (
      this.props.inGame !== prevProps.inGame ||
      this.props.musicIntensity !== prevProps.musicIntensity
    ) {
      setMusicInGame(this.props.inGame, this.props.musicIntensity);
    }
    if (this.props.enabled !== prevProps.enabled) {
      this.handleEnableState(this.props.enabled);
    } else {
      if (this.props.musicVolume !== prevProps.musicVolume) {
        setMusicVolume(this.props.musicVolume);
      }
      if (this.props.soundEffectsVolume !== prevProps.soundEffectsVolume) {
        setSoundEffectsVolume(this.props.soundEffectsVolume);
      }
    }

    if (this.props.enabled) {
      soundEffectsForUpdate(prevProps, this.props).forEach(playSoundEffect);
    }
  }

  public render(): React.JSX.Element | null {
    return null;
  }
}
