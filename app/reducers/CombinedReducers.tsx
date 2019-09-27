import Redux from 'redux'
import {game} from './Game'
import {navigation} from './Navigation'
import {snackbar} from './Snackbar'
import {AppState} from './StateTypes'

export default function combinedReduce(state: AppState, action: Redux.Action): AppState {
  state = state || ({} as AppState);
  return {
    game: game(state.game, action),
    navigation: navigation(state.navigation, action),
    snackbar: snackbar(state.snackbar, action),
  };
}
