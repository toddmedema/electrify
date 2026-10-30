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
 * its message, and its timer starts only once it shows.
 */
export default function DeferredSnackbar(
  props: SnackbarProps,
): React.JSX.Element {
  const modal = useModalOpen();
  return <Snackbar {...props} open={!!props.open && !modal} />;
}
