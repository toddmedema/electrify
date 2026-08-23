import type { AppDispatch } from "../../Store";
import { getScenario } from "../../data/Scenarios";
import { dialogClose, dialogOpen } from "../../reducers/UI";
import { readSave } from "../../SaveGame";

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
  // Autosave keeps one slot, so a new game replaces whatever's in it
  const save = readSave();
  const saved = save
    ? getScenario(save.game.scenarioId, save.game.customScenario)
    : undefined;
  if (!save || !saved) {
    return startGame();
  }
  dispatch(
    dialogOpen({
      title: "Start a new game?",
      message: `Your saved game (${saved.name}, ${save.game.date.year}) will be replaced.`,
      open: true,
      closeText: "Cancel",
      actionLabel: "Start new game",
      // The dialog's action button doesn't close the dialog on its own
      action: () => {
        dispatch(dialogClose());
        startGame();
      },
    }),
  );
}
