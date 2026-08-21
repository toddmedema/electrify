import type { AppStore } from "./Store";

let registered: AppStore | null = null;

/** Called by Store as soon as it has been created. */
export function registerStore(store: AppStore) {
  registered = store;
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
