import {
  loadAudioFiles,
  pause,
  playSoundEffect,
  resume,
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
}

export interface DispatchProps {
  disableAudio: () => void;
}

interface Props extends StateProps, DispatchProps {}

export default class Audio extends React.Component<Props, {}> {
  constructor(props: Props) {
    super(props);
    // Load after a timeout so as not to overload the device.
    setTimeout(() => {
      if (!this.props.enabled) {
        return;
      }
      this.handleEnableState(this.props.enabled);
    }, INIT_DELAY.LOAD_AUDIO_MILLIS);
  }

  private handleEnableState(enabled?: boolean) {
    if (audioState.loaded === "UNLOADED") {
      loadAudioFiles(this.props.musicVolume, this.props.soundEffectsVolume);
    } else if (audioState.loaded === "ERROR" && enabled) {
      this.props.disableAudio();
    } else {
      setMusicVolume(this.props.musicVolume);
      setSoundEffectsVolume(this.props.soundEffectsVolume);
      if (!enabled) {
        pause();
      } else {
        resume();
      }
    }
  }

  // This will fire many times without any audio-related changes since it subscribes to settings
  // So we have to be careful in checking that it's actually an audio-related change,
  // And not a different event that contains valid-looking (but identical) audio info
  componentDidUpdate(prevProps: StateProps) {
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
