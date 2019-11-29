import Redux from 'redux';
import {AppStateType} from '../Types';
import {audio} from './Audio';
import {audioData} from './AudioData';
import {card} from './Card';
import {gameState} from './GameState';
import {settings} from './Settings';
import {snackbar} from './Snackbar';

export default function combinedReduce(state: AppStateType, action: Redux.Action): AppStateType {
  state = state || ({} as AppStateType);

  // Run the reducers on the new action
  return {
    audio: audio(state.audio, action),
    audioData: audioData(state.audioData, action),
    card: card(state.card, action),
    gameState: gameState(state.gameState, action),
    settings: settings(state.settings, action),
    snackbar: snackbar(state.snackbar, action),
  } as AppStateType;
}
