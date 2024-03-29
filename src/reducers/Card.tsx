import Redux from 'redux';
import {NAVIGATION_DEBOUNCE_MS} from '../Constants';
import {CardNameType, CardType, NavigateAction} from '../Types';

export const initialCard: CardType = {
  name: 'MAIN_MENU' as CardNameType,
  ts: 0,
  history: ['MAIN_MENU'] as CardNameType[],
  toPrevious: false,
};

// ts: 0 solves an obscure bug (instead of Date.now()) where rapidly triggering navigations with undefined states
// (specifically from the editor) wouldn't work b/c their ts diffs were < DEBOUNCE
export function card(state: CardType = initialCard, action: Redux.Action): CardType {
  switch (action.type) {
    case 'NAVIGATE':
      const a = (action as NavigateAction);
      const to = a.to;
      if (to.name === state.name && to.ts - state.ts < NAVIGATION_DEBOUNCE_MS && !to.overrideDebounce) {
        return state;
      }
      // TODO better implementation for don't remember, right now it still makes an entry!
      return {
        ...to,
        history: [(a.dontRemember) ? state.name : to.name, ...state.history],
        toPrevious: false,
      };
    case 'NAVIGATE_BACK':
      return {
        name: state.history[1] || 'MAIN_MENU', // Look 2 back since first is current card
        ts: Date.now(),
        history: state.history.slice(1),
        toPrevious: true,
      };
    case 'GAME_START':
      return {
        name: 'LOADING',
        ts: Date.now(),
        history: state.history, // Don't store loading screen in history
      };
    case 'GAME_LOADED':
      return {
        name: 'FACILITIES',
        ts: Date.now(),
        history: ['FACILITIES', ...state.history],
      };
    case 'GAME_EXIT':
      return {
        ...initialCard,
      };
    default:
      return state;
  }
}
