import Redux from 'redux'
import {SnackbarOpenAction} from '../actions/ActionTypes'
import {SnackbarState} from './StateTypes'

export const initialSnackbar: SnackbarState = {
  open: false,
  message: '',
  timeout: 4000,
};

export function snackbar(state: SnackbarState = initialSnackbar, action: Redux.Action): SnackbarState {
  switch(action.type) {
    case 'SNACKBAR_OPEN':
      const openAction = (action as SnackbarOpenAction);
      if (openAction.message && openAction.message !== '') {
        return {
          open: true,
          message: openAction.message,
          timeout: openAction.timeout || initialSnackbar.timeout,
        };
      }
    case 'SNACKBAR_CLOSE':
      return {...initialSnackbar};
    default:
      return state;
  }
}
