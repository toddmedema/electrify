import Redux from 'redux';
import {NavigateAction} from '../actions/ActionTypes';
import {NAVIGATION_DEBOUNCE_MS} from '../Constants';
import {CardName, CardState} from './StateTypes';

export const initialCardState: CardState = {
  key: '',
  name: 'SPLASH_CARD' as CardName,
  ts: 0,
};

// ts: 0 solves an obscure bug (instead of Date.now()) where rapidly triggering navigations with undefined states
// (specifically from the editor) wouldn't work b/c their ts diffs were < DEBOUNCE
export function card(state: CardState = initialCardState, action: Redux.Action): CardState {
  switch (action.type) {
    case 'NAVIGATE':
      const to = (action as NavigateAction).to;
      if (to.key === state.key && to.ts - state.ts < NAVIGATION_DEBOUNCE_MS && !to.overrideDebounce) {
        return state;
      }
      return to;
    // case 'QUEST_EXIT':
    //   return {
    //     ...initialCardState,
    //     name: getStorageString(NAV_CARD_STORAGE_KEY, 'TUTORIAL_QUESTS') as CardName,
    //   };
    default:
      return state;
  }
}
