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

export interface DispatchProps {
  disableAudio: () => void;
}

interface Props extends StateProps, DispatchProps {}

export default class Audio extends React.Component<Props, {}> {
  private loadTimer: ReturnType<typeof setTimeout> | undefined;

  /** Track scene and gesture changes, then prepare installed-app music after startup settles. */
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
      else if (isInstalledWebApp()) this.loadAudio();
    }, INIT_DELAY.LOAD_AUDIO_MILLIS);
  }

  componentWillUnmount() {
    clearTimeout(this.loadTimer);
    document.removeEventListener("click", this.onGesture, true);
    document.removeEventListener("touchend", this.onGesture, true);
    document.removeEventListener("keydown", this.onGesture, true);
    pause();
  }

  /** Retry autoplay permission and transient loads while the gesture is still active. */
  private onGesture = () => {
    if (
      !this.props.enabled ||
      document.visibilityState === "hidden" ||
      audioState.loaded === "UNSUPPORTED"
    )
      return;
    if (audioState.paused) resume();
    else unlockAudio();
    if (audioState.loaded !== "LOADING" && audioState.loaded !== "LOADED")
      this.loadAudio();
  };

  /** Report missing Web Audio support while leaving download and decode failures retryable. */
  private loadAudio() {
    if (audioState.loaded !== "UNSUPPORTED")
      void loadAudioFiles(
        this.props.musicVolume,
        this.props.soundEffectsVolume,
      );
    if (audioState.loaded === "UNSUPPORTED" && this.props.enabled)
      this.props.disableAudio();
  }

  /** Apply the master switch without moving the playhead or retrying unsupported devices. */
  private handleEnableState(enabled?: boolean) {
    if (!enabled) {
      pause();
      return;
    }
    clearTimeout(this.loadTimer);
    setMusicVolume(this.props.musicVolume);
    setSoundEffectsVolume(this.props.soundEffectsVolume);
    resume();
    this.loadAudio();
  }

  /** Keep scene mixing, volume controls and event cues aligned with the latest game state. */
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
