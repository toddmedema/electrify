import Redux from 'redux';
import {UIType} from '../Types';

export const initialUI: UIType = {
  snackbar: {
    message: '',
    open: false,
    timeout: 6000,
  },
};

export function ui(state: UIType = initialUI, action: Redux.Action): UIType {
  switch (action.type) {
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
