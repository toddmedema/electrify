import { expect, Page } from "@playwright/test";
import { decodeSave, encodeSave } from "../src/SaveEncoding";
import { SAVE_DATABASE_NAME } from "../src/SaveRepository";
import { selectContinueSave } from "../src/SaveModel";
import type { GameType, SaveGameType, SaveMetadata } from "../src/Types";

type WireRecord = { metadata: SaveMetadata; save: unknown };

/** Wait for the asynchronous lifecycle flush before inspecting the real save database. */
async function flushSave(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  const status = page.locator("[data-save-state]:visible").first();
  if (await status.count()) {
    await expect(status).toHaveAttribute("data-save-state", /^(saved|idle)$/);
  }
}

export async function readSaveRecords(page: Page): Promise<WireRecord[]> {
  return page.evaluate(
    (databaseName) =>
      new Promise<WireRecord[]>((resolve, reject) => {
        const request = indexedDB.open(databaseName);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("saves")) {
            db.close();
            resolve([]);
            return;
          }
          const tx = db.transaction(["saves", "payloads"], "readonly");
          const metadata = tx.objectStore("saves").getAll();
          const payloads = tx.objectStore("payloads").getAll();
          tx.onerror = () => reject(tx.error);
          tx.oncomplete = () => {
            db.close();
            const rows = (metadata.result as SaveMetadata[]).map((entry) => ({
              metadata: entry,
              save: payloads.result.find((payload) => payload.id === entry.id)
                ?.save,
            }));
            rows.sort(
              (a, b) =>
                (b.metadata.lastPlayedAt || b.metadata.createdAt).localeCompare(
                  a.metadata.lastPlayedAt || a.metadata.createdAt,
                ) || a.metadata.id.localeCompare(b.metadata.id),
            );
            resolve(rows);
          };
        };
      }),
    SAVE_DATABASE_NAME,
  );
}

async function selectedRecord(
  page: Page,
  saveId?: string,
): Promise<WireRecord | undefined> {
  const entries = await readSaveRecords(page);
  const live = page.locator("[data-active-save-id]:visible").first();
  const currentRow = page
    .locator('article[data-current-save="true"]:visible')
    .first();
  const id =
    saveId ||
    ((await live.count())
      ? await live.getAttribute("data-active-save-id")
      : undefined) ||
    ((await currentRow.count())
      ? await currentRow.getAttribute("data-save-id")
      : undefined) ||
    selectContinueSave(entries.map((record) => record.metadata))?.id;
  return entries.find((record) => record.metadata.id === id);
}

export async function readSavedGame(
  page: Page,
  saveId?: string,
): Promise<GameType | undefined> {
  await flushSave(page);
  const record = await selectedRecord(page, saveId);
  await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
  return record ? (decodeSave(record.save) as SaveGameType).game : undefined;
}

/** Edit a flushed fixture, preserving the production codec and invalidating its old writer. */
export async function editSavedGame<T>(
  page: Page,
  edit: (save: SaveGameType) => T,
  saveId?: string,
): Promise<T> {
  await flushSave(page);
  const record = await selectedRecord(page, saveId);
  if (!record) throw new Error("No saved game exists to edit.");
  const save = decodeSave(record.save) as SaveGameType;
  const result = edit(save);
  await page.evaluate(
    ({ databaseName, id, wire, date }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(databaseName);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(
            ["saves", "payloads", "sessions"],
            "readwrite",
          );
          const metadata = tx.objectStore("saves").get(id);
          const payload = tx.objectStore("payloads").get(id);
          metadata.onsuccess = () =>
            tx.objectStore("saves").put({
              ...metadata.result,
              revision: metadata.result.revision + 1,
              date,
            });
          payload.onsuccess = () =>
            tx.objectStore("payloads").put({
              ...payload.result,
              save: JSON.parse(wire),
            });
          tx.objectStore("sessions").delete(id);
          tx.onabort = () => reject(tx.error);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
    {
      databaseName: SAVE_DATABASE_NAME,
      id: record.metadata.id,
      wire: JSON.stringify(encodeSave(save)),
      date: { month: save.game.date.month, year: save.game.date.year },
    },
  );
  return result;
}
