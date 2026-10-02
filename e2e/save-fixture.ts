import { Page } from "@playwright/test";
import { decodeSave, encodeSave } from "../src/SaveEncoding";
import type { GameType } from "../src/Types";
type SaveGameType = { game: GameType; commitmentForecast?: unknown[] };

/** Edit domain state while letting the production codec own its on-disk representation. */
export async function editSavedGame<T>(
  page: Page,
  edit: (save: SaveGameType) => T,
): Promise<T> {
  const raw = await page.evaluate(() => {
    window.dispatchEvent(new Event("pagehide"));
    return JSON.parse(localStorage.getItem("savedGame")!);
  });
  const save = decodeSave(raw) as SaveGameType;
  const result = edit(save);
  await page.evaluate(
    (wire) => {
      localStorage.setItem("savedGame", wire);
    },
    JSON.stringify(encodeSave(save)),
  );
  return result;
}
