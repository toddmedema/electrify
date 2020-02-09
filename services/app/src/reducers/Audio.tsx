import Redux from 'redux';
import {AudioSetAction, AudioType} from '../Types';

export const initialAudio: AudioType = {
  intensity: 0,
  loaded: 'UNLOADED',
  paused: false,
  sfx: null,
  timestamp: 0,
};

export function audio(state: AudioType = initialAudio, action: Redux.Action): AudioType {
  switch (action.type) {
    case 'AUDIO_SET':
      return {...state, ...(action as AudioSetAction).delta};
    default:
      return state;
  }
}
