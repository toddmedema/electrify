import {VIBRATION_LONG_MS, VIBRATION_SHORT_MS} from '../Constants';
import {getHistoryApi, getNavigator, logEvent} from '../Globals';
import {store} from '../Store';
import {CardNameType} from '../Types';
import {NavigateAction, NavigateBackAction} from '../Types';

export function toCard(a: {name: CardNameType, overrideDebounce?: boolean, vibrateLong?: boolean, dontRemember?: boolean}) {
  const nav = getNavigator();
  const state = store.getState();
  const vibration = state.settings && state.settings.vibration;

  if (nav && nav.vibrate && vibration) {
    nav.vibrate((a.vibrateLong) ? VIBRATION_LONG_MS : VIBRATION_SHORT_MS);
  }

  logEvent('card_view', {card: a.name});

  getHistoryApi().pushState(null, '', '#');

  return {type: 'NAVIGATE', to: {...a, ts: Date.now()}, dontRemember: a.dontRemember} as NavigateAction;
}

export function toPrevious() {
  return {type: 'NAVIGATE_BACK'} as NavigateBackAction;
}
