/** Shared so the blackout toast and its all-clear can recognize and replace each other. */
export const BLACKOUT_TOAST_PREFIX = "Blackout:";
export const BLACKOUT_OVER_TOAST =
  "Blackout over. Supply is meeting demand again.";

export function isBlackoutToast(message: string): boolean {
  return (
    message.startsWith(BLACKOUT_TOAST_PREFIX) || message === BLACKOUT_OVER_TOAST
  );
}

/**
 * A blackout change yields only to an unrelated toast, such as an Undo it must not steal. A
 * blackout toast it supersedes is replaced, shown or held, so neither one can go stale.
 */
export function blackoutToastCanShow(snackbar: {
  open: boolean;
  message: string;
}): boolean {
  return !snackbar.open || isBlackoutToast(snackbar.message);
}
