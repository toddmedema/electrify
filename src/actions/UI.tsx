import {DialogCloseAction, DialogOpenAction, DialogType, SnackbarCloseAction, SnackbarOpenAction} from '../Types';

export function closeSnackbar(): SnackbarCloseAction {
  return {type: 'SNACKBAR_CLOSE'};
}

export function closeDialog(): DialogCloseAction {
  return {type: 'DIALOG_CLOSE'};
}

export function openDialog(dialog: DialogType): DialogOpenAction {
  return {
    dialog,
    type: 'DIALOG_OPEN',
  };
}

export function openSnackbar(message: string, timeout?: number): SnackbarOpenAction {
  return {
    message,
    timeout,
    type: 'SNACKBAR_OPEN',
  };
}
