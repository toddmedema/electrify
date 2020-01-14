import Redux from 'redux';
import {DialogOpenAction, UiDeltaAction, UIType} from '../Types';

export const initialUI: UIType = {
  dialog: {
    title: '',
    message: '',
    open: false,
  },
  snackbar: {
    message: '',
    open: false,
    timeout: 6000,
  },
};

export function uiDelta(delta: Partial<UIType>): UiDeltaAction {
  return { type: 'UI_DELTA', delta };
}

export function ui(state: UIType = initialUI, action: Redux.Action): UIType {
  switch (action.type) {
    case 'UI_DELTA':
      return {...state, ...(action as UiDeltaAction).delta};
    // case 'SNACKBAR_OPEN':
    //   const openAction = (action as SnackbarOpenAction);
    //   if (openAction.message && openAction.message !== '') {
    //     return {
    //       action: openAction.action || initialUI.action,
    //       actionLabel: openAction.actionLabel || initialUI.actionLabel,
    //       message: openAction.message,
    //       open: true,
    //       timeout: initialUI.timeout,
    //     };
    //   }
    //   return state;
    case 'SNACKBAR_CLOSE':
      return {...state, snackbar: {...initialUI.snackbar}};
    case 'DIALOG_OPEN':
      return {...state, dialog: {...(action as DialogOpenAction).dialog}};
    case 'DIALOG_CLOSE':
    case 'GAME_EXIT':
      return {...state, dialog: {...initialUI.dialog}};
    default:
      return state;
  }
}
