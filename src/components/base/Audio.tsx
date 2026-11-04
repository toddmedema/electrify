import {
  loadAudioFiles,
  pause,
  playSoundEffect,
  resume,
  setMusicInGame,
  setMusicVolume,
  setSoundEffectsVolume,
  state as audioState,
  unlockAudio,
} from "../../data/Audio";
import {
  soundEffectsForUpdate,
  SoundEventSnapshot,
} from "../../audio/SoundEvents";
import { INIT_DELAY } from "../../Constants";
import { isInstalledWebApp } from "../../InstalledApp";
import * as React from "react";

export interface StateProps extends SoundEventSnapshot {
  enabled?: boolean;
  musicVolume: number;
  soundEffectsVolume: number;
  musicIntensity: number;
}

export default class Audio extends React.Component<StateProps, {}> {
  private loadTimer: ReturnType<typeof setTimeout> | undefined;

  componentDidMount() {
    setMusicInGame(this.props.inGame, this.props.musicIntensity);
    if (!this.props.enabled || document.visibilityState === "hidden") pause();
    document.addEventListener("click", this.onGesture, true);
    document.addEventListener("touchend", this.onGesture, true);
    document.addEventListener("keydown", this.onGesture, true);
    // Load after a timeout so as not to overload the device.
    this.loadTimer = setTimeout(() => {
      if (this.props.enabled && document.visibilityState !== "hidden")
        this.handleEnableState(true);
      else if (isInstalledWebApp())
        void loadAudioFiles(
          this.props.musicVolume,
          this.props.soundEffectsVolume,
        );
    }, INIT_DELAY.LOAD_AUDIO_MILLIS);
  }

  componentWillUnmount() {
    clearTimeout(this.loadTimer);
    document.removeEventListener("click", this.onGesture, true);
    document.removeEventListener("touchend", this.onGesture, true);
    document.removeEventListener("keydown", this.onGesture, true);
    pause();
  }

  private onGesture = () => {
    if (!this.props.enabled || document.visibilityState === "hidden") return;
    if (audioState.paused) resume();
    else unlockAudio();
    if (audioState.loaded === "UNLOADED" || audioState.loaded === "ERROR") {
      void loadAudioFiles(
        this.props.musicVolume,
        this.props.soundEffectsVolume,
      );
    }
  };

  private handleEnableState(enabled?: boolean) {
    if (!enabled) {
      pause();
      return;
    }
    clearTimeout(this.loadTimer);
    setMusicVolume(this.props.musicVolume);
    setSoundEffectsVolume(this.props.soundEffectsVolume);
    resume();
    void loadAudioFiles(this.props.musicVolume, this.props.soundEffectsVolume);
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
