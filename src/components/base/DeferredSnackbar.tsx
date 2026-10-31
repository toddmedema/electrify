import * as React from "react";
import { Snackbar, SnackbarProps } from "@mui/material";

/** MUI portals every modal to the body; a Dialog carries this class while it is open. */
const MODAL_SELECTOR = ".MuiDialog-root";

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
 * the dialog's own feedback, so `overModal` shows it straight away, at the top of the window
 * where it clears the dialog's actions.
 */
export default function DeferredSnackbar({
  overModal,
  anchorOrigin,
  ...props
}: SnackbarProps & { overModal?: boolean }): React.JSX.Element {
  const modal = useModalOpen();
  return (
    <Snackbar
      {...props}
      anchorOrigin={
        overModal ? { vertical: "top", horizontal: "center" } : anchorOrigin
      }
      open={!!props.open && (!modal || !!overModal)}
    />
  );
}
