import { getLocalStorage } from "./Globals";
import { LocalStoragePlayedType, ScenarioType } from "./Types";

// Force specifying a default, since just doing (|| fallback) would bork on stored falsey values
export function getStorageBoolean(key: string, fallback: boolean): boolean {
  const val = getLocalStorage().getItem(key);
  return val !== null ? val.toLowerCase() === "true" : fallback;
}

export function getStorageBooleanOrUndefined(key: string): boolean | undefined {
  const val = getLocalStorage().getItem(key);
  return val !== null ? val.toLowerCase() === "true" : undefined;
}

export function getStorageJson<T extends object>(key: string, fallback: T): T {
  try {
    const item = getLocalStorage().getItem(key);
    if (item === null) {
      return fallback;
    }
    const val = JSON.parse(item) as T | null;
    return val !== null ? val : fallback;
  } catch (_err) {
    return fallback;
  }
}

export function getStorageNumber(key: string, fallback: number): number {
  const val = getLocalStorage().getItem(key);
  return val !== null ? Number(val) : fallback;
}

export function getStorageString(key: string, fallback: string): string {
  const val = getLocalStorage().getItem(key);
  return val !== null ? val : fallback;
}

// Restores a dropdown's last choice. The stored value is only honoured while it's still one of
// the options on offer - a metric that has since been renamed, or a year belonging to a game
// that's been replaced, falls back rather than leaving the control showing something it can't
// plot. Works for numeric and string valued selects alike, since storage only holds strings.
export function getStorageChoice<T extends number | string>(
  key: string,
  options: readonly T[],
  fallback: T,
): T {
  const val = getLocalStorage().getItem(key);
  if (val === null) {
    return fallback;
  }
  const match = options.find((option) => String(option) === val);
  return match !== undefined ? match : fallback;
}

// Value can be boolean, number, string or stringifiable JSON.
// Writes throw when storage is full or the browser blocks it, and no caller has anything useful
// to do about that, so by default the write is best effort. Pass ignoreErrors: false where the
// value has to land.
export function setStorageKeyValue(
  key: string,
  value: unknown,
  ignoreErrors = true,
) {
  const serialized =
    typeof value === "object" ? JSON.stringify(value) : String(value);
  try {
    getLocalStorage().setItem(key, serialized);
  } catch (err) {
    if (!ignoreErrors) {
      throw err;
    }
  }
}

// Best effort for the same reason as setStorageKeyValue: nothing useful to do if it throws
export function removeStorageKey(key: string) {
  try {
    getLocalStorage().removeItem(key);
  } catch (_err) {
    // Ignore errors
  }
}

function getPlays(): LocalStoragePlayedType[] {
  return getStorageJson<{ plays: LocalStoragePlayedType[] }>("plays", {
    plays: [],
  }).plays;
}

// The scenarios (tutorials included) the player has finished, used for the completion
// markers and progress in the scenario list
export function getPlayedScenarioIds(): number[] {
  return Object.keys(getScenarioPlayCounts()).map(Number);
}

// Counts completed plays without appending one entry per replay, which would grow this list
// forever. Records written before counts were introduced represent one completed play.
export function getScenarioPlayCounts(): Record<number, number> {
  return getPlays().reduce<Record<number, number>>((counts, play) => {
    counts[play.scenarioId] =
      (counts[play.scenarioId] ?? 0) + (play.timesPlayed ?? 1);
    return counts;
  }, {});
}

export function recordScenarioPlayed(scenarioId: number) {
  const plays = getPlays();
  const existingIndex = plays.findIndex((p) => p.scenarioId === scenarioId);
  if (existingIndex !== -1) {
    const existing = plays[existingIndex];
    const updated = [...plays];
    updated[existingIndex] = {
      ...existing,
      timesPlayed: (existing.timesPlayed ?? 1) + 1,
    };
    setStorageKeyValue("plays", { plays: updated });
    return;
  }
  setStorageKeyValue("plays", {
    plays: [
      ...plays,
      {
        scenarioId,
        date: new Date().toString(),
        timesPlayed: 1,
      } as LocalStoragePlayedType,
    ],
  });
}

const CUSTOM_GAME_KEY = "customGame";

// The last game the player set up on the custom game screen, so it opens where they left it
// rather than back at the defaults. Unlike a save, this is only the setup, never a game in
// progress - see SaveGame for the latter
export function getCustomScenario(fallback: ScenarioType): ScenarioType {
  return getStorageJson<ScenarioType>(CUSTOM_GAME_KEY, fallback);
}

export function recordCustomScenario(scenario: ScenarioType) {
  setStorageKeyValue(CUSTOM_GAME_KEY, scenario);
}

// Check for free space in local storage by allocating space.
// We don't check for free space past 10MiB; it's assumed
// the user won't care about storage space past that point.
export function checkStorageFreeBytes(gls = getLocalStorage): number {
  const ls = gls();
  let min = 0; // Kib
  let max = 10000; // Kib
  const n1000b = "0123456789".repeat(100);
  // Converging on 10MiB would take log_2(10M) = 24 iterations.
  // If we're past this limit, something's gone wrong and we
  // should bail out with our best guess.
  const CHECK_MAX_ITERATIONS = 50;
  let i = 0;
  while (Math.abs(max - min) > 1 && i < CHECK_MAX_ITERATIONS) {
    const test = Math.floor((max - min) / 2 + min);
    try {
      ls.setItem("test", n1000b.repeat(test));
      // If no exception, we're under the max. Raise min.
      min = test;
    } catch (_e) {
      // If exception, we're over the max. Lower max.
      max = test;
    }
    i++;
  }

  try {
    ls.removeItem("test");
  } catch (_e) {
    // Ignore errors
  }
  return min * 1000;
}
