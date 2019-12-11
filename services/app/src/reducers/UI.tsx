import Redux from 'redux';
import {UiDeltaAction, UIType} from '../Types';

export const initialUI: UIType = {
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
    // case 'SNACKBAR_CLOSE':
    //   return {...initialUI};
    default:
      return state;
  }
}
