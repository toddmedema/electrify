import packageJson from "../package.json";
import { MINUTES_PER_MONTH } from "./helpers/DateTime";
import { isValidLocation } from "./helpers/Locations";
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
// v4 persists calibrated demand and authored absolute-load schedules on the live game slice.
export const SAVE_VERSION = 4;

export function saveVersionError(raw: unknown): string | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const version = (raw as { version?: unknown }).version;
  if (typeof version !== "number" || version === SAVE_VERSION) {
    return undefined;
  }
  return version < SAVE_VERSION
    ? "That save was created by an older simulation version and can't be resumed."
    : "That save was created by a newer simulation version and can't be resumed.";
}

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
    typeof game.customerMarketSize !== "number" ||
    !Number.isFinite(game.customerMarketSize) ||
    game.customerMarketSize <= 0 ||
    typeof game.startingDemandScale !== "number" ||
    !Number.isFinite(game.startingDemandScale) ||
    game.startingDemandScale <= 0 ||
    !Array.isArray(game.loadAdditions) ||
    game.loadAdditions.some(
      (addition) =>
        typeof addition !== "object" ||
        addition === null ||
        typeof addition.id !== "string" ||
        typeof addition.label !== "string" ||
        typeof addition.startsYear !== "number" ||
        !Number.isInteger(addition.startsYear) ||
        (addition.startsMonth !== undefined &&
          (typeof addition.startsMonth !== "number" ||
            !Number.isInteger(addition.startsMonth) ||
            addition.startsMonth < 1 ||
            addition.startsMonth > 12)) ||
        typeof addition.peakW !== "number" ||
        !Number.isFinite(addition.peakW) ||
        addition.peakW < 0 ||
        typeof addition.loadFactor !== "number" ||
        !Number.isFinite(addition.loadFactor) ||
        addition.loadFactor < 0 ||
        addition.loadFactor > 1 ||
        addition.demandType !== "Data centers",
    ) ||
    typeof game.customerRate !== "number" ||
    !Number.isFinite(game.customerRate) ||
    game.customerRate < 0 ||
    // Checked in full rather than trusted, the same way decodeReplay checks a replay's: the
    // location's id becomes the path of the weather file the loading screen fetches, and its
    // lat/long and time zone drive the sun model. A save is hand-editable too
    !isValidLocation(game.location)
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
  if (!Array.isArray(game.facilities)) {
    return null;
  }
  if (
    game.facilities.some((facility) => {
      if (typeof facility !== "object" || facility === null) {
        return true;
      }
      const current = facility as Record<string, unknown>;
      const requiredNumbersInvalid = [
        current.annualOperatingCost,
        current.lifespanYears,
        current.lifetimeWh,
        current.lifetimePotentialWh,
        current.lifetimeRevenue,
        current.lifetimeExpenses,
        current.peakW,
      ].some((value) => typeof value !== "number" || !Number.isFinite(value));
      const optionalNumbersInvalid = [
        current.costPerStart,
        current.lifetimeStarts,
        current.minimumStableOutput,
        current.variableOperatingCostPerMWh,
      ].some(
        (value) =>
          value !== undefined &&
          (typeof value !== "number" || !Number.isFinite(value) || value < 0),
      );
      const optionalBooleansInvalid = [
        current.committed,
        current.tracksStarts,
        current.generatingLastRealTick,
      ].some((value) => value !== undefined && typeof value !== "boolean");
      return (
        requiredNumbersInvalid ||
        optionalNumbersInvalid ||
        (typeof current.minimumStableOutput === "number" &&
          current.minimumStableOutput > 1) ||
        optionalBooleansInvalid
      );
    }) ||
    !Array.isArray(game.timeline) ||
    !Array.isArray(game.monthlyHistory) ||
    game.monthlyHistory.some((month) => {
      if (typeof month !== "object" || month === null) {
        return true;
      }
      const record = month as Partial<GameType["monthlyHistory"][number]>;
      return (
        typeof record.deliveredWhByFuel !== "object" ||
        record.deliveredWhByFuel === null ||
        Object.values(record.deliveredWhByFuel).some(
          (value) =>
            typeof value !== "number" || !Number.isFinite(value) || value < 0,
        ) ||
        typeof record.peakDemandW !== "number" ||
        !Number.isFinite(record.peakDemandW) ||
        record.peakDemandW < 0 ||
        (record.minimumSupplyMarginW !== undefined &&
          (typeof record.minimumSupplyMarginW !== "number" ||
            !Number.isFinite(record.minimumSupplyMarginW)))
      );
    }) ||
    !Array.isArray(game.eventLog) ||
    !Array.isArray(game.reportedEventKeys) ||
    typeof game.eventLogReadThroughId !== "number"
  ) {
    return null;
  }
  const worldEvents = game.worldEvents as
    Partial<GameType["worldEvents"]> | undefined;
  if (
    typeof worldEvents !== "object" ||
    worldEvents === null ||
    !Array.isArray(worldEvents.active) ||
    !Array.isArray(worldEvents.occurrences) ||
    !Array.isArray(worldEvents.checkedKeys)
  ) {
    return null;
  }
  // Older v4 sessions could record the opening forecast as an extra completed month. History is
  // newest-first, so any impossible excess is the oldest tail and can be repaired losslessly.
  const completedMonths = Math.floor(game.date.minute / MINUTES_PER_MONTH);
  if (game.monthlyHistory.length > completedMonths) {
    game.monthlyHistory = game.monthlyHistory.slice(0, completedMonths);
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
 * otherwise need their short-lived objective state restored too.
 */
export function startAutosave(
  store: AppStore,
  isSaveableScenario: (scenarioId: number) => boolean,
): () => void {
  // The slice as of the last notification where a game was running. Quit resets the slice before
  // the subscriber sees it, so flushing on the way out needs the state as it was, not as it is.
  let live: GameType | undefined;
  let savedYear = -1;
  // The exact Redux snapshot that was written. Time is not enough to identify a change: while
  // paused, a player can still build, sell, reorder, change rates, or pause a facility without
  // advancing the minute.
  let saved: GameType | undefined;
  // A full disk fails every year; saying so once is a warning, saying so every year is a bug
  let warnedAboutFailure = false;

  const write = (game: GameType) => {
    if (writeSave(game)) {
      savedYear = game.date.year;
      saved = game;
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
    if (!live || live === saved) {
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
      saved = undefined;
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
