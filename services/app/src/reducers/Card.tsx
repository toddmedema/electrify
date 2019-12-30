import Redux from 'redux';
import {NAVIGATION_DEBOUNCE_MS} from '../Constants';
import {CardNameType, CardType, NavigateAction} from '../Types';

export const initialCard: CardType = {
  name: 'MAIN_MENU' as CardNameType,
  ts: 0,
  history: ['MAIN_MENU'] as CardNameType[],
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
      return {
        ...to,
        history: [to.name, ...state.history],
      };
    case 'NAVIGATE_BACK':
      return {
        name: state.history[1], // Look 2 back since first is current card
        ts: Date.now(),
        history: state.history.slice(1),
      };
    case 'GAME_START':
      return {
        name: 'LOADING',
        ts: Date.now(),
        history: state.history, // Don't store loading screen in history
      };
    case 'GAME_LOADED':
      return {
        name: 'GENERATORS',
        ts: Date.now(),
        history: ['GENERATORS', ...state.history],
      };
    case 'GAME_EXIT':
      return {
        ...initialCard,
      };
    default:
      return state;
  }
}
