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
// 2: facilities carry the rate their loan was signed at, and the game carries the rate a new one
// would cost. A version 1 save has neither, and a loan with no rate cannot be repaid.
export const SAVE_VERSION = 2;

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
 * Writes the game slice to local storage as the player plays: once at the turn of each game year,
 * plus whatever is left over on the way out. Returns its own teardown.
 *
 * A game year is 1152 ticks, so even at FAST speed this is a write every eleven seconds or so --
 * infrequent enough that it doesn't need throttling, and unthrottled means every year boundary
 * actually lands rather than being collapsed into a later one.
 *
 * isSaveableScenario is injected rather than looked up here (see the note at the top of the file);
 * pass a predicate that rejects tutorials, which are short enough not to be worth saving and would
 * need their mid-Joyride step restored too.
 */
export function startAutosave(
  store: AppStore,
  isSaveableScenario: (scenarioId: number) => boolean,
): () => void {
  // The slice as of the last notification where a game was running. Quit resets the slice before
  // the subscriber sees it, so flushing on the way out needs the state as it was, not as it is.
  let live: GameType | undefined;
  let savedYear = -1;
  // What was actually written, so the flush below can tell whether anything has happened since
  let savedMinute = -1;
  // A full disk fails every year; saying so once is a warning, saying so every year is a bug
  let warnedAboutFailure = false;

  const write = (game: GameType) => {
    if (writeSave(game)) {
      savedYear = game.date.year;
      savedMinute = game.date.minute;
    } else if (!warnedAboutFailure) {
      warnedAboutFailure = true;
      store.dispatch(
        snackbarOpen("Couldn't save your game - browser storage is full."),
      );
    }
  };

  /**
   * Writes the part-year since the last save, on the way out of a game -- quitting to the menu,
   * hiding the tab, or closing it. Without this a player who quits partway through a year comes
   * back to the start of it, since quit fires none of the page lifecycle events.
   *
   * Only ever updates a save that's still there. The first moment of any game writes immediately,
   * so a missing save means the scenario ended and cleared it, and a bankrupt run shouldn't come
   * back from the dead.
   */
  const flush = () => {
    if (!live || live.date.minute === savedMinute) {
      return;
    }
    if (readSave()?.game.scenarioId !== live.scenarioId) {
      return;
    }
    write(live);
  };

  const unsubscribe = store.subscribe(() => {
    const game = store.getState().game;
    // A replay is somebody else's run being re-simulated; writing it over the watcher's own save
    // would cost them their game
    if (
      !game.inGame ||
      game.replayPlayback ||
      !isSaveableScenario(game.scenarioId)
    ) {
      flush();
      live = undefined;
      return;
    }
    if (!live) {
      // A game just started or resumed, and nothing of it is written yet. Saving immediately is
      // what lets the flush above treat a missing save as "the scenario ended".
      savedYear = -1;
      savedMinute = -1;
    }
    live = game;
    if (game.date.year !== savedYear) {
      write(game);
    }
  });

  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      flush();
    }
  };
  document.addEventListener("visibilitychange", onVisibilityChange, false);
  // pagehide rather than beforeunload, which mobile browsers routinely never fire
  window.addEventListener("pagehide", flush, false);

  return () => {
    unsubscribe();
    document.removeEventListener("visibilitychange", onVisibilityChange, false);
    window.removeEventListener("pagehide", flush, false);
  };
}
