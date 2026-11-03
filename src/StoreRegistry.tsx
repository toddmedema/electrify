import type { AppStore } from "./Store";
import type { HighscoreSubmissionType } from "./reducers/User";

/** Browser effects are registered by Store; worker forecasts have no browser services. */
export interface GameEffects {
  logEvent: (eventName: string, args?: object) => void;
  recordScenarioPlayed: (scenarioId: number) => void;
  submitHighscore: (submission: HighscoreSubmissionType) => void;
}

const noEffects: GameEffects = {
  logEvent: () => undefined,
  recordScenarioPlayed: () => undefined,
  submitHighscore: () => undefined,
};

let registered: AppStore | null = null;
let effects = noEffects;

/** Called by Store as soon as it has been created. */
export function registerStore(
  store: AppStore,
  gameEffects: GameEffects = noEffects,
) {
  registered = store;
  effects = gameEffects;
}

export function getGameEffects(): GameEffects {
  return effects;
}

/**
 * The app's store, resolved when it is called rather than when the module is imported.
 *
 * The game reducer dispatches follow-up actions -- the tick timer, end of game dialogs, the
 * construction complete snackbar -- and importing the store directly to do that puts a
 * Game -> Store -> Game cycle back in place, which breaks whichever module loads first. The type
 * import above is erased at build time, so this module has no runtime dependencies at all.
 */
export function getStore(): AppStore {
  if (!registered) {
    throw new Error(
      "The store was used before it was created. Import ./Store somewhere first.",
    );
  }
  return registered;
}
