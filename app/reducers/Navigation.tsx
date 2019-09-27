import Redux from 'redux'
import {NavigationState} from './StateTypes'
import {NavigateAction} from '../actions/ActionTypes'
import {NAVIGATION_DEBOUNCE_MS} from '../Constants'

export const initialNavigation: NavigationState = {
  page: 'HOME',
  transition: 'INSTANT',
  ts: 0,
};

export function navigation(state: NavigationState = initialNavigation, action: Redux.Action): NavigationState {
  switch(action.type) {
    case 'NAVIGATE':
      const a = action as NavigateAction;
      if (Date.now() - state.ts < NAVIGATION_DEBOUNCE_MS) {
        return state;
      }
      return {
        page: a.page,
        transition: a.transition || 'NEXT',
        ts: Date.now(),
      };
    default:
      return state;
  }
}
