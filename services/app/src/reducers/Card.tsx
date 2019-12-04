import Redux from 'redux';
import {NAVIGATION_DEBOUNCE_MS} from '../Constants';
import {CardNameType, CardType, NavigateAction} from '../Types';

export const initialCard: CardType = {
  name: 'MAIN_MENU' as CardNameType,
  ts: 0,
};

// ts: 0 solves an obscure bug (instead of Date.now()) where rapidly triggering navigations with undefined states
// (specifically from the editor) wouldn't work b/c their ts diffs were < DEBOUNCE
export function card(state: CardType = initialCard, action: Redux.Action): CardType {
  switch (action.type) {
    case 'NAVIGATE':
      const to = (action as NavigateAction).to;
      if (to.name === state.name && to.ts - state.ts < NAVIGATION_DEBOUNCE_MS && !to.overrideDebounce) {
        return state;
      }
      return to;
    case 'GAME_START':
      return {
        name: 'SUPPLY',
        ts: Date.now(),
      };
    case 'GAME_EXIT':
      return {
        ...initialCard,
      };
    default:
      return state;
  }
}
