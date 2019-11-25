import * as Redux from 'redux';
import {VIBRATION_LONG_MS, VIBRATION_SHORT_MS} from '../Constants';
import {getNavigator} from '../Globals';
import {CardName} from '../reducers/StateTypes';
import {getStore} from '../Store';
import {NavigateAction} from './ActionTypes';

export function toCard(a: {name: CardName, noHistory?: boolean, overrideDebounce?: boolean, vibrateLong?: boolean}) {
  return (dispatch: Redux.Dispatch<any>): any => {
    const nav = getNavigator();
    const state = getStore().getState();
    const vibration = state.settings && state.settings.vibration;

    if (nav && nav.vibrate && vibration) {
      nav.vibrate((a.vibrateLong) ? VIBRATION_LONG_MS : VIBRATION_SHORT_MS);
    }

    dispatch({type: 'NAVIGATE', to: {...a, ts: Date.now()}} as NavigateAction);
  };
}
