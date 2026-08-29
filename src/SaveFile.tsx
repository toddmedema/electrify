import { getScenario } from "./data/Scenarios";
import {
  parseSave,
  readSave,
  SaveGameType,
  saveVersionError,
} from "./SaveGame";
import { ScenarioType } from "./Types";

/**
 * Moving a save between the browser and a file, plus the question the settings screen and the
 * title screen both ask first: is there a game worth resuming?
 *
 * Separate from SaveGame so that module can keep to storage and nothing else (see the note at the
 * top of it). Answering that question means resolving a scenario, and data/Scenarios imports the
 * game reducer, which imports SaveGame -- a cycle reducers/ImportOrder.test.tsx guards against.
 * Nothing in the reducers imports this file, so the chain stops here.
 */

export interface ResumableSaveType {
  save: SaveGameType;
  scenario: ScenarioType;
}

/**
 * The saved game, if there is one and this build still has the scenario it was played in. A save
 * whose scenario has since been removed can't be resumed, so it may as well not be offered; a
 * custom game carries its own scenario in the save, so it resolves the same way any other does.
 */
export function resumableSave(): ResumableSaveType | null {
  const save = readSave();
  const scenario = save
    ? getScenario(save.game.scenarioId, save.game.customScenario)
    : undefined;
  return save && scenario ? { save, scenario } : null;
}

/** What the player sees the save called: "Rise of Renewables, 2035". */
export function describeSave({ save, scenario }: ResumableSaveType): string {
  return `${scenario.name}, ${save.game.date.year}`;
}

/**
 * electrify-rise-of-renewables-2035.json. Scenario names are authored, but a custom game's is
 * typed by the player, so everything outside a-z0-9 is folded away rather than trusted in a
 * filename.
 */
export function saveFilename(scenarioName: string, year: number): string {
  const slug = scenarioName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `electrify-${slug || "game"}-${year}.json`;
}

/** Hands the saved game to the browser as a download. */
export function downloadSave(resumable: ResumableSaveType) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(resumable.save)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = saveFilename(
    resumable.scenario.name,
    resumable.save.game.date.year,
  );
  // Firefox only follows the click of an anchor that's actually in the document
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking in the same task cancels the download in Safari; a task later is after it started
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * A cap on what will be read into memory. A century-long run saves at a few hundred kilobytes, so
 * this sits far past any real save; it's here so that pointing the file picker at a video doesn't
 * hang the tab before the JSON parse gets a chance to reject it.
 */
export const MAX_SAVE_FILE_BYTES = 8 * 1024 * 1024;

/** Either the save, or why the file the player picked isn't one. */
export interface ImportedSaveType {
  save?: SaveGameType;
  error?: string;
}

/**
 * Validates a file the player picked. Everything about it is untrusted -- a save is plain JSON,
 * hand-editable, and shared between players -- so it's checked all the way down to the scenario
 * being one this build has, rather than crashing the sim mid-tick on the first missing field.
 */
export async function readSaveFile(file: File): Promise<ImportedSaveType> {
  if (file.size > MAX_SAVE_FILE_BYTES) {
    return { error: "That file is too big to be an Electrify save." };
  }
  let text: string;
  try {
    text = await readText(file);
  } catch (_err) {
    return { error: "Couldn't read that file." };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (_err) {
    return { error: "That file isn't an Electrify save game." };
  }
  const versionError = saveVersionError(parsed);
  if (versionError) {
    return { error: versionError };
  }
  const save = parseSave(parsed);
  if (!save) {
    return {
      error: "That file isn't a compatible Electrify save game.",
    };
  }
  if (!getScenario(save.game.scenarioId, save.game.customScenario)) {
    return {
      error:
        "That save is from a scenario this version of Electrify doesn't have.",
    };
  }
  return { save };
}

// FileReader keeps this path testable in jsdom and works across the supported browsers.
function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
