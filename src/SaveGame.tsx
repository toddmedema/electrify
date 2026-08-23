import packageJson from "../package.json";
import {
  getStorageJson,
  removeStorageKey,
  setStorageKeyValue,
} from "./LocalStorage";
import { snackbarOpen } from "./reducers/UI";
import { GameType } from "./Types";
import type { AppStore } from "./Store";

/**
 * Saving and restoring a game.
 *
 * Only the game slice is persisted. Every random draw in the simulation is addressed by
 * (seed, stream, index) rather than pulled from a running generator, so the weather and fuel price
 * caches -- which live outside Redux -- rebuild themselves identically from state.seed on the other
 * side of a reload. Nothing sequential has to be carried in the save.
 *
 * This module deliberately imports almost nothing: reducers/Game reaches back here for
 * clearSaveFor, and data/Scenarios imports reducers/Game, so importing the scenarios from here
 * would close the cycle that reducers/ImportOrder.test.tsx guards against. Callers that need to
 * know about scenarios (whether one is a tutorial, what it's called) pass that in.
 */

export const SAVE_KEY = "savedGame";
// Bump on any breaking schema change. Mismatched saves are ignored rather than migrated.
export const SAVE_VERSION = 1;

// One write per game month is roughly one a second at FAST speed, and the blob is ~100KB, so
// rollovers inside this window are collapsed into the next eligible one
const AUTOSAVE_THROTTLE_MS = 5000;

export interface SaveGameType {
  version: number;
  savedAt: string; // ISO 8601
  appVersion: string; // For bug reports
  game: GameType;
}

// mapStateToProps runs on every dispatch, and re-parsing ~100KB of JSON each time to decide whether
// to show a Continue button would be silly. Only ever populated by an actual read: writing and
// clearing invalidate it rather than filling it in, so what's cached is always what's in storage
// and never an alias of the live (and still mutating) game slice.
let cached: SaveGameType | null | undefined;

export function serializeSave(game: GameType): SaveGameType {
  return {
    version: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    appVersion: packageJson.version,
    game,
  };
}

/**
 * Validates an untrusted blob and returns it as a save, or null if it isn't one. Takes unknown
 * rather than reading storage itself so that the same checks cover an imported file, where a
 * malformed facility would otherwise crash the sim mid-tick.
 */
export function parseSave(raw: unknown): SaveGameType | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const save = raw as Partial<SaveGameType>;
  if (save.version !== SAVE_VERSION) {
    return null;
  }
  const game = save.game as Partial<GameType> | undefined;
  if (typeof game !== "object" || game === null) {
    return null;
  }
  if (
    typeof game.scenarioId !== "number" ||
    typeof game.seed !== "number" ||
    typeof game.startingYear !== "number" ||
    typeof game.location !== "object" ||
    game.location === null
  ) {
    return null;
  }
  if (
    typeof game.date !== "object" ||
    game.date === null ||
    typeof game.date.minute !== "number"
  ) {
    return null;
  }
  if (
    !Array.isArray(game.facilities) ||
    !Array.isArray(game.timeline) ||
    !Array.isArray(game.monthlyHistory)
  ) {
    return null;
  }
  return save as SaveGameType;
}

export function readSave(): SaveGameType | null {
  if (cached === undefined) {
    // getStorageJson already returns the fallback for missing keys and unparseable JSON
    cached = parseSave(getStorageJson<object>(SAVE_KEY, {}));
  }
  return cached;
}

// Returns false when the write didn't land, so the caller can tell the player rather than silently
// losing their game
export function writeSave(game: GameType): boolean {
  cached = undefined;
  try {
    setStorageKeyValue(SAVE_KEY, serializeSave(game), false);
  } catch (_err) {
    return false;
  }
  return true;
}

export function clearSave() {
  cached = undefined;
  removeStorageKey(SAVE_KEY);
}

/**
 * Clears the save only if it belongs to the given scenario. Scenarios end for reasons that have
 * nothing to do with what's in the save -- a tutorial runs a single month and "wins" on the way
 * past -- and throwing away someone else's saved run over that would be a nasty way to lose a game.
 */
export function clearSaveFor(scenarioId: number) {
  if (readSave()?.game.scenarioId === scenarioId) {
    clearSave();
  }
}

/**
 * Whether the slice arriving at the loading screen was restored by resume() rather than being a
 * fresh game waiting for initGame. The timeline is the tell: it's empty on a new game (start clears
 * it, and initialGame starts it empty) and only initGame or resume ever fills it.
 */
export function isResumedGame(game: GameType): boolean {
  return game.timeline.length > 0;
}

/**
 * Writes the game slice to local storage as the player plays. Returns its own teardown.
 *
 * isSaveableScenario is injected rather than looked up here (see the note at the top of the file);
 * pass a predicate that rejects tutorials, which are short enough not to be worth saving and would
 * need their mid-Joyride step restored too.
 */
export function startAutosave(
  store: AppStore,
  isSaveableScenario: (scenarioId: number) => boolean,
): () => void {
  let savedMonthsEllapsed = -1;
  let lastWriteMs = 0;
  // Set when a rollover was skipped by the throttle, so the change isn't lost if the player stops
  // playing before the next one
  let pending = false;
  // A full disk fails every month; saying so once is a warning, saying so every month is a bug
  let warnedAboutFailure = false;

  const write = () => {
    const game = store.getState().game;
    if (writeSave(game)) {
      savedMonthsEllapsed = game.date.monthsEllapsed;
      lastWriteMs = performance.now();
      pending = false;
    } else if (!warnedAboutFailure) {
      warnedAboutFailure = true;
      store.dispatch(
        snackbarOpen("Couldn't save your game - browser storage is full."),
      );
    }
  };

  const saveable = () => {
    const game = store.getState().game;
    return game.inGame && isSaveableScenario(game.scenarioId);
  };

  const unsubscribe = store.subscribe(() => {
    if (!saveable()) {
      return;
    }
    const { monthsEllapsed } = store.getState().game.date;
    if (monthsEllapsed === savedMonthsEllapsed) {
      return;
    }
    pending = true;
    if (performance.now() - lastWriteMs < AUTOSAVE_THROTTLE_MS) {
      return;
    }
    write();
  });

  // The write that actually matters: whatever the throttle skipped, flushed the moment the player
  // leaves. pagehide rather than beforeunload, which mobile browsers routinely never fire.
  const flush = () => {
    if (pending && saveable()) {
      write();
    }
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      flush();
    }
  };
  document.addEventListener("visibilitychange", onVisibilityChange, false);
  window.addEventListener("pagehide", flush, false);

  return () => {
    unsubscribe();
    document.removeEventListener("visibilitychange", onVisibilityChange, false);
    window.removeEventListener("pagehide", flush, false);
  };
}
