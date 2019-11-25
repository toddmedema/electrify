import Redux from 'redux';
import {audio} from './Audio';
import {audioData} from './AudioData';
import {card} from './Card';
import {serverstatus} from './ServerStatus';
import {settings} from './Settings';
import {snackbar} from './Snackbar';
import {AppState} from './StateTypes';

export default function combinedReduce(state: AppState, action: Redux.Action): AppState {
  state = state || ({} as AppState);

  // Run the reducers on the new action
  return {
    audio: audio(state.audio, action),
    audioData: audioData(state.audioData, action),
    card: card(state.card, action),
    settings: settings(state.settings, action),
    serverstatus: serverstatus(state.serverstatus, action),
    snackbar: snackbar(state.snackbar, action),
  } as AppState;
}
