import type { AppDispatch } from "../../Store";
import { dialogClose, dialogOpen } from "../../reducers/UI";
import { describeSave, resumableSave } from "../../SaveFile";

/**
 * Runs something that would replace the autosave, first asking about the game already in it.
 *
 * Autosave keeps one slot, so starting a new game or importing someone else's replaces whatever
 * is there. Proceeds straight away when there's nothing to lose.
 */
export function confirmReplacingSave(
  dispatch: AppDispatch,
  { title, actionLabel }: { title: string; actionLabel: string },
  proceed: () => void,
) {
  const resumable = resumableSave();
  if (!resumable) {
    return proceed();
  }
  dispatch(
    dialogOpen({
      title,
      message: `Your saved game (${describeSave(resumable)}) will be replaced.`,
      open: true,
      closeText: "Cancel",
      actionLabel,
      // The dialog's action button doesn't close the dialog on its own
      action: () => {
        dispatch(dialogClose());
        proceed();
      },
    }),
  );
}

/**
 * Starts a game, first asking about the autosave if starting would overwrite it.
 *
 * Shared by the scenario details screen and the custom game screen, which reach start() with
 * different payloads - hence the callback rather than a scenario id. Tutorials don't go through
 * here: they're never autosaved, so they have nothing to clobber.
 */
export function startWithSaveGuard(
  dispatch: AppDispatch,
  startGame: () => void,
) {
  confirmReplacingSave(
    dispatch,
    { title: "Start a new game?", actionLabel: "Start new game" },
    startGame,
  );
}
