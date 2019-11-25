import {getStore} from '../Store';
import {SnackbarCloseAction, SnackbarOpenAction} from './ActionTypes';

export function closeSnackbar(): SnackbarCloseAction {
  return {type: 'SNACKBAR_CLOSE'};
}

export function openSnackbar(message: string|Error, showError?: boolean): SnackbarOpenAction {
  return {
    message,
    type: 'SNACKBAR_OPEN',
  };
}
