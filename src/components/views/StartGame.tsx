import type { AppDispatch } from "../../Store";
import { runSaveTransition } from "../../SaveSession";

/**
 * Save the current run before a launch replaces live game state.
 */
export function startWithSaveGuard(
  _dispatch: AppDispatch,
  startGame: () => void,
) {
  void runSaveTransition(startGame);
}
