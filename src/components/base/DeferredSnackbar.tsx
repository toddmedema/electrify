import * as React from "react";
import { Snackbar, SnackbarProps } from "@mui/material";
import {
  BLACKOUT_OVER_TOAST,
  BLACKOUT_TOAST_PREFIX,
} from "../../helpers/BlackoutToast";
import { snackbarOpen } from "../../reducers/UI";
import { useAppDispatch, useAppSelector } from "../../Store";

/** MUI portals every modal to the body; a Dialog carries this class while it is open. */
const MODAL_SELECTOR = ".MuiDialog-root";
const BLACKOUT_OVER_TIMEOUT_MS = 4000;

function modalOpen(): boolean {
  return !!document.querySelector(MODAL_SELECTOR);
}

/** Whether a dialog is showing, tracked across dialogs owned by any component. */
export function useModalOpen(): boolean {
  const [open, setOpen] = React.useState(modalOpen);
  React.useEffect(() => {
    const update = () => setOpen(modalOpen());
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true });
    return () => observer.disconnect();
  }, []);
  return open;
}

/**
 * A toast waits for an open dialog to close instead of covering its actions. Hidden, it keeps
 * its message, and its timer starts only once it shows. A toast raised by the dialog itself is
 * the dialog's own feedback, so `overModal` shows it straight away.
 *
 * A blackout that ends while its toast is held would otherwise resurface as false news, and the
 * end-of-blackout toast yields to the held one, so the held toast is replaced here.
 */
export default function DeferredSnackbar({
  overModal,
  ...props
}: SnackbarProps & { overModal?: boolean }): React.JSX.Element {
  const modal = useModalOpen();
  const dispatch = useAppDispatch();
  const message = useAppSelector((state) => state.ui.snackbar.message);
  const toastOpen = useAppSelector((state) => state.ui.snackbar.open);
  const inBlackout = useAppSelector((state) => !!state.game.blackout);
  React.useEffect(() => {
    if (
      modal &&
      toastOpen &&
      !inBlackout &&
      message.startsWith(BLACKOUT_TOAST_PREFIX)
    ) {
      dispatch(
        snackbarOpen({
          message: BLACKOUT_OVER_TOAST,
          open: true,
          timeout: BLACKOUT_OVER_TIMEOUT_MS,
        }),
      );
    }
  }, [dispatch, inBlackout, message, modal, toastOpen]);
  return <Snackbar {...props} open={!!props.open && (!modal || !!overModal)} />;
}
