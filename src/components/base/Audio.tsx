import { loadAudioFiles, state as audioState } from "../../data/Audio";
import { INIT_DELAY } from "../../Constants";
import * as React from "react";

export interface StateProps {
  enabled?: boolean;
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
      this.handleEnableState();
    }, INIT_DELAY.LOAD_AUDIO_MILLIS);
  }

  private handleEnableState(enabled?: boolean) {
    if (audioState.loaded === "UNLOADED") {
      loadAudioFiles();
    } else if (audioState.loaded === "ERROR" && enabled) {
      this.props.disableAudio();
    } else {
      const tm = audioState.themeManager;
      if (!tm) {
        return;
      }
      if (!enabled) {
        tm.pause();
      } else {
        tm.resume();
      }
    }
  }

  // This will fire many times without any audio-related changes since it subscribes to settings
  // So we have to be careful in checking that it's actually an audio-related change,
  // And not a different event that contains valid-looking (but identical) audio info
  componentDidUpdate(prevProps: StateProps, prevState: any) {
    if (this.props.enabled !== prevProps.enabled) {
      this.handleEnableState(this.props.enabled);
    }
  }

  public render(): JSX.Element | null {
    return null;
  }
}
