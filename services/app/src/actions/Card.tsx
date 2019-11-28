import {VIBRATION_LONG_MS, VIBRATION_SHORT_MS} from '../Constants';
import {getNavigator} from '../Globals';
import {getStore} from '../Store';
import {CardNameType} from '../Types';
import {NavigateAction} from '../Types';

export function toCard(a: {name: CardNameType, overrideDebounce?: boolean, vibrateLong?: boolean}) {
  const nav = getNavigator();
  const state = getStore().getState();
  const vibration = state.settings && state.settings.vibration;

  if (nav && nav.vibrate && vibration) {
    nav.vibrate((a.vibrateLong) ? VIBRATION_LONG_MS : VIBRATION_SHORT_MS);
  }

  return {type: 'NAVIGATE', to: {...a, ts: Date.now()}} as NavigateAction;
}
