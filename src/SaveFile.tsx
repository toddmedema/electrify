import { parseSave } from "./SaveGame";
import { validateSaveFileEnvelope } from "./SaveModel";
import { encodeSave } from "./SaveEncoding";
import type { SaveFileType } from "./Types";

/** Filename fragments are selected from the player's save name, never used as a path. */
export function saveFilename(name: string, year: number): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `electrify-${slug || "game"}-${year}.json`;
}

/** The current envelope contains no local identity, ownership or played-order bookkeeping. */
export function encodeSaveFile(file: SaveFileType) {
  const valid = validateSaveFileEnvelope(file, parseSave);
  return { ...valid, save: encodeSave(valid.save) };
}

export function downloadSave(file: SaveFileType): void {
  const wire = encodeSaveFile(file);
  downloadJson(saveFilename(file.name, file.save.game.date.year), wire);
}

/** A clearly labeled recovery file is raw diagnostic data, not a resumable save envelope. */
export function downloadSaveRecovery(id: string, raw: unknown): void {
  const fragment = id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  downloadJson(`electrify-recovery-${fragment || "save"}.json`, raw);
}

function downloadJson(filename: string, raw: unknown): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(raw)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  // Firefox follows only anchors attached to the document.
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking synchronously can cancel a Safari download before it starts.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export const MAX_SAVE_FILE_BYTES = 8 * 1024 * 1024;
