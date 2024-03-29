import Redux from 'redux';
import {AudioDataSetAction, AudioDataType} from '../Types';

export const initialStaticFiles: AudioDataType = {
  audioNodes: null,
  themeManager: null,
};

export function audioData(state: AudioDataType = initialStaticFiles, action: Redux.Action): AudioDataType {
  switch (action.type) {
    case 'AUDIO_DATA_SET':
      return {...state, ...(action as AudioDataSetAction).data};
    default:
      return state;
  }
}
