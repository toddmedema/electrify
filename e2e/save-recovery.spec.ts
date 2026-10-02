import { readFile } from "fs/promises";
import { expect, Locator, Page, Route, test } from "@playwright/test";
import { decodeSave } from "../src/SaveEncoding";
import { SAVE_DATABASE_NAME } from "../src/SaveRepository";
import type { SaveFileType, SaveGameType } from "../src/Types";
import { openPane } from "./layout";
import { editSavedGame, readSavedGame, readSaveRecords } from "./save-fixture";

type FaultWindow = Window & { saveRecoveryFault?: boolean };
interface WriterRecord {
  saveId: string;
  writerToken: string;
  expiresAt: number;
}

/** Fault the real persistence boundary; readonly inspection and direct file export still work. */
async function installStorageFault(page: Page, initialFailure = false) {
  await page.addInitScript((failed) => {
    (window as FaultWindow).saveRecoveryFault = failed;
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (
      stores: string | Iterable<string>,
      mode?: IDBTransactionMode,
      options?: IDBTransactionOptions,
    ) {
      if (
        (window as FaultWindow).saveRecoveryFault &&
        mode === "readwrite" &&
        Array.from(typeof stores === "string" ? [stores] : stores).includes(
          "payloads",
        )
      ) {
        throw new DOMException(
          "Injected storage quota failure",
          "QuotaExceededError",
        );
      }
      return original.call(this, stores, mode, options);
    };
  }, initialFailure);
}

async function setStorageFault(page: Page, failed: boolean) {
  await page.evaluate((value) => {
    (window as FaultWindow).saveRecoveryFault = value;
  }, failed);
}

const saveState = (page: Page) =>
  page.locator("[data-save-state]:visible").first();

async function startGame(page: Page, initialFailure = false) {
  await installStorageFault(page, initialFailure);
  await page.goto("/?scenario=101");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(page.locator("#appbar:visible")).toBeVisible();
  await expect(saveState(page)).toHaveAttribute(
    "data-save-state",
    initialFailure ? "failed" : "saved",
  );
  const id = await saveState(page).getAttribute("data-active-save-id");
  expect(id).toBeTruthy();
  return id!;
}

async function openSaves(page: Page) {
  await page.getByRole("button", { name: "menu", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Saved games", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Saved games", exact: true }),
  ).toBeVisible();
}

async function saveAndQuit(page: Page) {
  await page.getByRole("button", { name: "menu", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Save & Quit", exact: true })
    .click();
}

/** Make a real decision while paused, without relying on elapsed simulation time. */
async function changeRate(page: Page): Promise<number> {
  const insights = page.locator(".insights:visible");
  await openPane(
    insights,
    page.getByRole("button", { name: "Insights", exact: true }),
  );
  await expect(insights).toHaveCount(1);
  const showRate = insights.getByRole("button", { name: "Show rate slider" });
  if (await showRate.isVisible()) await showRate.click();
  const slider = insights.getByRole("slider", {
    name: "The rate you charge for electricity generation",
  });
  const before = await slider.getAttribute("aria-valuenow");
  await slider.press("ArrowRight");
  await expect(slider).not.toHaveAttribute("aria-valuenow", before!);
  return Number(await slider.getAttribute("aria-valuenow"));
}

async function exportedFile(page: Page, button: Locator) {
  const downloadPromise = page.waitForEvent("download");
  await button.click();
  const download = await downloadPromise;
  const path = (await download.path())!;
  const wire = JSON.parse(await readFile(path, "utf8"));
  const file: SaveFileType = {
    ...wire,
    save: decodeSave(wire.save) as SaveGameType,
  };
  return { path, file };
}

async function importCopy(page: Page, id: string) {
  const row = page.locator('[data-save-id="' + id + '"]');
  await row.getByRole("button", { name: /^Actions for/ }).click();
  const exported = await exportedFile(
    page,
    page.getByRole("menuitem", { name: "Export", exact: true }),
  );
  await page.getByLabel("Save game file").setInputFiles(exported.path);
  await expect(page.locator("article[data-save-id]")).toHaveCount(2);
  const copy = (await readSaveRecords(page)).find(
    (record) => record.metadata.id !== id,
  )!;
  expect(copy.metadata.lastPlayedAt).toBeUndefined();
  return copy.metadata.id;
}

async function readWriters(page: Page): Promise<WriterRecord[]> {
  return page.evaluate(
    (databaseName) =>
      new Promise<WriterRecord[]>((resolve, reject) => {
        const request = indexedDB.open(databaseName);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction("sessions", "readonly");
          const writers = transaction.objectStore("sessions").getAll();
          transaction.onabort = () => reject(transaction.error);
          transaction.oncomplete = () => {
            db.close();
            resolve(writers.result);
          };
        };
      }),
    SAVE_DATABASE_NAME,
  );
}

async function expireWriter(page: Page, id: string) {
  await page.evaluate(
    ({ databaseName, saveId }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(databaseName);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction("sessions", "readwrite");
          const sessions = transaction.objectStore("sessions");
          const writer = sessions.get(saveId);
          writer.onsuccess = () =>
            sessions.put({ ...writer.result, expiresAt: 0 });
          transaction.onabort = () => reject(transaction.error);
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
    { databaseName: SAVE_DATABASE_NAME, saveId: id },
  );
}

/** Keep a real sessions transaction alive long enough for a paused clock callback to arrive. */
async function holdWriterTransactions(page: Page) {
  await page.evaluate(
    (databaseName) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(databaseName);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction("sessions", "readwrite");
          const started = performance.now();
          const keepAlive = () => {
            const pending = transaction
              .objectStore("sessions")
              .get("contention-probe");
            pending.onsuccess = () => {
              if (performance.now() - started < 750) keepAlive();
            };
          };
          transaction.oncomplete = () => db.close();
          transaction.onabort = () => db.close();
          keepAlive();
          resolve();
        };
      }),
    SAVE_DATABASE_NAME,
  );
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("audioEnabled", "false"));
});

test("quota recovery saves on Retry, exports live decisions, and requires explicit abandonment", async ({
  page,
}) => {
  const id = await startGame(page);
  await setStorageFault(page, true);
  const updatedRate = await changeRate(page);
  await expect(saveState(page)).toHaveAttribute("data-save-state", "failed");
  await saveAndQuit(page);
  const failure = page.getByRole("dialog", {
    name: "Your game could not be saved",
  });
  await expect(failure).toContainText("Browser storage is full");
  await expect(
    failure.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
  await failure.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(failure).toBeHidden();
  await expect(saveState(page)).toHaveAttribute("data-active-save-id", id);
  await expect(saveState(page)).toHaveAttribute("data-save-state", "failed");

  await saveAndQuit(page);
  const exported = await exportedFile(
    page,
    failure.getByRole("button", { name: "Export current game", exact: true }),
  );
  expect(exported.file.save.game.dollarsPerkWh).toBe(updatedRate);
  expect(exported.file.status).toBe("inProgress");
  await expect(failure).toBeVisible();
  await expect(saveState(page)).toHaveAttribute("data-active-save-id", id);

  await setStorageFault(page, false);
  await failure.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(saveState(page)).toHaveAttribute("data-active-save-id", id);
  expect((await readSavedGame(page, id))!.dollarsPerkWh).toBe(updatedRate);

  await setStorageFault(page, true);
  const abandonedRate = await changeRate(page);
  expect(abandonedRate).not.toBe(updatedRate);
  await expect(saveState(page)).toHaveAttribute("data-save-state", "failed");
  await saveAndQuit(page);
  await failure
    .getByRole("button", { name: "Leave without saving", exact: true })
    .click();
  const abandoning = page.getByRole("dialog", {
    name: "Leave without saving?",
  });
  await expect(abandoning).toContainText(
    "Changes since the last successful save will be lost",
  );
  await expect(
    abandoning.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
  await abandoning.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(abandoning).toBeHidden();
  await expect(saveState(page)).toHaveAttribute("data-active-save-id", id);

  await saveAndQuit(page);
  await failure
    .getByRole("button", { name: "Leave without saving", exact: true })
    .click();
  await abandoning
    .getByRole("button", { name: "Leave without saving", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeVisible();
  await setStorageFault(page, false);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(saveState(page)).toHaveAttribute("data-active-save-id", id);
  expect((await readSavedGame(page, id))!.dollarsPerkWh).toBe(updatedRate);
  expect(await readSaveRecords(page)).toHaveLength(1);
});

test("a failed first save remains exportable and Retry creates the original pending identity once", async ({
  page,
}) => {
  const id = await startGame(page, true);
  expect(await readSaveRecords(page)).toHaveLength(0);
  await openSaves(page);
  const pending = page.getByRole("article", { name: "Unsaved current game" });
  await expect(pending).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry save", exact: true }),
  ).toHaveCount(1);
  const exported = await exportedFile(
    page,
    pending.getByRole("button", { name: "Export current game", exact: true }),
  );
  expect(exported.file.status).toBe("inProgress");
  expect(exported.file.save.game.scenarioId).toBe(101);
  expect(await readSaveRecords(page)).toHaveLength(0);
  await setStorageFault(page, false);
  await pending
    .getByRole("button", { name: "Retry save", exact: true })
    .click();
  await expect(page.locator('[data-save-id="' + id + '"]')).toBeVisible();
  expect(
    (await readSaveRecords(page)).map((record) => record.metadata.id),
  ).toEqual([id]);
});

test("a never-saved game can be discarded without creating or resurrecting a record", async ({
  page,
}) => {
  await startGame(page, true);
  await openSaves(page);
  const pending = page.getByRole("article", { name: "Unsaved current game" });
  await pending
    .getByRole("button", { name: "Discard and leave", exact: true })
    .click();
  const discarding = page.getByRole("dialog", { name: "Discard this game?" });
  await expect(discarding).toContainText("has never been saved");
  await expect(
    discarding.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
  await discarding
    .getByRole("button", { name: "Discard and leave", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "No saved games yet" }),
  ).toBeVisible();
  await setStorageFault(page, false);
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  expect(await readSaveRecords(page)).toHaveLength(0);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toHaveCount(0);
});

test("failed active deletion restores its writer and successful deletion cannot be resurrected", async ({
  page,
}) => {
  const id = await startGame(page);
  await openSaves(page);
  const row = page.locator('[data-save-id="' + id + '"]');
  await setStorageFault(page, true);
  await row.getByRole("button", { name: /^Actions for/ }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  const deleting = page.getByRole("dialog", { name: "Delete saved game?" });
  await deleting.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: /storage/ }),
  ).toBeVisible();
  await expect(deleting).toBeVisible();
  expect(
    (await readSaveRecords(page)).map((record) => record.metadata.id),
  ).toEqual([id]);
  await deleting.getByRole("button", { name: "Cancel", exact: true }).click();
  await setStorageFault(page, false);
  await row
    .getByRole("button", { name: "Return to game", exact: true })
    .click();
  const rate = await changeRate(page);
  await expect
    .poll(async () => (await readSavedGame(page, id))?.dollarsPerkWh)
    .toBe(rate);
  await expect(saveState(page)).toHaveAttribute("data-save-state", "saved");

  await openSaves(page);
  await row.getByRole("button", { name: /^Actions for/ }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await deleting.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No saved games yet" }),
  ).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  expect(await readSaveRecords(page)).toHaveLength(0);
  await page.reload();
  expect(await readSaveRecords(page)).toHaveLength(0);
});

test("failed Resume data loading releases the target, preserves played order, and clears gameplay history", async ({
  page,
}) => {
  const id = await startGame(page);
  await openSaves(page);
  const copyId = await importCopy(page, id);
  await page.route("**/data/weather/**", (route) => route.abort("failed"));
  await page
    .locator('[data-save-id="' + copyId + '"]')
    .getByRole("button", {
      name: "Resume",
      exact: true,
    })
    .click();
  const failure = page.getByRole("dialog", {
    name: "Could not prepare this game",
  });
  await expect(failure).toContainText("Could not load the weather");
  const records = await readSaveRecords(page);
  expect(records).toHaveLength(2);
  expect(
    records.find((record) => record.metadata.id === copyId)!.metadata
      .lastPlayedAt,
  ).toBeUndefined();
  expect(await readWriters(page)).toEqual([]);
  await failure.getByRole("button", { name: "OK", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#appbar:visible")).toHaveCount(0);
});

test("a delayed Resume cannot commit after a fresh writer takes its expired lease", async ({
  page,
  context,
}) => {
  const id = await startGame(page);
  await openSaves(page);
  const copyId = await importCopy(page, id);
  const held: Route[] = [];
  await page.route("**/data/weather/**", (route) => {
    held.push(route);
  });
  await page
    .locator('[data-save-id="' + copyId + '"]')
    .getByRole("button", {
      name: "Resume",
      exact: true,
    })
    .click();
  // SF requires its city and watershed records. Waiting for both prevents a partially held load.
  await expect.poll(() => held.length).toBe(2);
  await expireWriter(page, copyId);
  const other = await context.newPage();
  await other.goto("/");
  await other.getByRole("button", { name: "Saved games", exact: true }).click();
  await other
    .locator('[data-save-id="' + copyId + '"]')
    .getByRole("button", {
      name: "Resume",
      exact: true,
    })
    .click();
  await expect(saveState(other)).toHaveAttribute("data-save-state", "saved");
  const newer = (await readSaveRecords(other)).find(
    (record) => record.metadata.id === copyId,
  )!;
  await Promise.all(held.map((route) => route.continue()));
  await page.unroute("**/data/weather/**");
  await expect(
    page.getByRole("dialog", { name: "Could not prepare this game" }),
  ).toContainText(/another tab|newer progress/);
  const latest = (await readSaveRecords(other)).find(
    (record) => record.metadata.id === copyId,
  )!;
  expect(latest.metadata.revision).toBe(newer.metadata.revision);
  expect(latest.metadata.lastPlayedAt).toBe(newer.metadata.lastPlayedAt);
  expect(latest.save).toEqual(newer.save);
  await expect(other.locator("#appbar:visible")).toBeVisible();
  await expect(page.locator("#appbar:visible")).toHaveCount(0);
  expect((await readWriters(other)).map((writer) => writer.saveId)).toEqual([
    copyId,
  ]);
});

test("a damaged inactive save offers recovery data without blocking a healthy current game", async ({
  page,
}) => {
  const id = await startGame(page);
  await openSaves(page);
  const copyId = await importCopy(page, id);
  await page.evaluate(
    ({ databaseName, saveId }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(databaseName);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction("payloads", "readwrite");
          const payloads = transaction.objectStore("payloads");
          const payload = payloads.get(saveId);
          payload.onsuccess = () =>
            payloads.put({
              ...payload.result,
              save: { invalid: "damaged fixture" },
            });
          transaction.onabort = () => reject(transaction.error);
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
    { databaseName: SAVE_DATABASE_NAME, saveId: copyId },
  );
  const broken = page.locator('[data-save-id="' + copyId + '"]');
  await broken.getByRole("button", { name: "Resume", exact: true }).click();
  const failure = page.getByRole("dialog", {
    name: "Could not open this save",
  });
  await expect(failure).toBeVisible();
  await failure.getByRole("button", { name: "OK", exact: true }).click();
  await expect(
    broken.getByRole("button", { name: "Unavailable", exact: true }),
  ).toBeDisabled();
  await expect(broken).toContainText("Download its recovery data");
  expect((await readWriters(page)).map((writer) => writer.saveId)).toEqual([
    id,
  ]);
  expect(
    (await readSaveRecords(page)).find(
      (record) => record.metadata.id === copyId,
    )!.metadata.lastPlayedAt,
  ).toBeUndefined();

  await broken.getByRole("button", { name: /^Actions for/ }).click();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Download recovery data", exact: true })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^electrify-recovery-/);
  const raw = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(raw).toMatchObject({
    metadata: { id: copyId },
    payload: { id: copyId, save: { invalid: "damaged fixture" } },
  });
  await page
    .locator('[data-save-id="' + id + '"]')
    .getByRole("button", { name: "Return to game", exact: true })
    .click();
  await expect(saveState(page)).toHaveAttribute("data-active-save-id", id);
  const rate = await changeRate(page);
  await expect
    .poll(async () => (await readSavedGame(page, id))?.dollarsPerkWh)
    .toBe(rate);
  await expect(saveState(page)).toHaveAttribute("data-save-state", "saved");
});

test("completed saves remain writable and historical results leave the current run unchanged", async ({
  page,
}) => {
  const id = await startGame(page);
  await page
    .getByRole("button", { name: "fast speed", exact: true })
    .first()
    .click();
  await expect(
    page.locator("#appbar:visible .gameStatusValue.weak"),
  ).not.toContainText("Jan 2002");
  await page
    .getByRole("button", { name: "pause", exact: true })
    .first()
    .click();
  await editSavedGame(
    page,
    (save) => {
      // Preserve the reducer's one-row-per-completed-month rollover invariant. Jumping
      // time with an empty history would intentionally catch up and score on every tick.
      const realMonth = save.game.monthlyHistory[0];
      expect(realMonth).toBeDefined();
      save.game.monthlyHistory = Array.from({ length: 143 }, (_, index) => {
        const month = 142 - index;
        return {
          ...realMonth,
          year: save.game.startingYear + Math.floor(month / 12),
          month: (month % 12) + 1,
        };
      });
      const offset = 144 * 1440 - 15 - save.game.date.minute;
      save.game.date.minute += offset;
      save.game.date.monthsElapsed = 143;
      for (const tick of save.game.timeline) tick.minute += offset;
      save.game.meaningfulDecisions = [
        {
          key: "rate",
          lever: "rate",
          label: "Changed the retail rate",
          month: 1,
          kind: "rate",
          before: "$0.10/kWh",
          after: "$0.11/kWh",
        },
      ];
    },
    id,
  );
  await page.reload();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("button", { name: "normal speed", exact: true })
    .first()
    .click();
  const victory = page.getByRole("dialog", { name: "Mission complete" });
  await expect(victory).toBeVisible();
  await victory
    .getByRole("button", { name: "Review grid", exact: true })
    .click();
  await page
    .getByRole("button", { name: "pause", exact: true })
    .first()
    .click();
  const continuedRate = await changeRate(page);
  await expect
    .poll(async () => (await readSavedGame(page, id))?.dollarsPerkWh)
    .toBe(continuedRate);
  expect(
    (await readSaveRecords(page)).find((record) => record.metadata.id === id)!
      .metadata.status,
  ).toBe("completed");

  await openSaves(page);
  const copyId = await importCopy(page, id);
  const before = (await readSaveRecords(page)).find(
    (record) => record.metadata.id === id,
  )!;
  const owner = (await readWriters(page)).find(
    (writer) => writer.saveId === id,
  )!;
  const copy = page.locator('[data-save-id="' + copyId + '"]');
  await copy.getByRole("button", { name: /^Actions for/ }).click();
  await page
    .getByRole("menuitem", { name: "View result", exact: true })
    .click();
  const historical = page.getByRole("dialog", { name: "Mission complete" });
  await expect(historical).toBeVisible();
  await expect(historical.getByRole("button")).toHaveCount(1);
  await historical.getByRole("button", { name: "Close", exact: true }).click();
  await expect(historical).toBeHidden();
  const after = (await readSaveRecords(page)).find(
    (record) => record.metadata.id === id,
  )!;
  expect(after.save).toEqual(before.save);
  expect(after.metadata.revision).toBe(before.metadata.revision);
  expect(
    (await readWriters(page)).find((writer) => writer.saveId === id)!
      .writerToken,
  ).toBe(owner.writerToken);
  await page
    .locator('[data-save-id="' + id + '"]')
    .getByRole("button", {
      name: "Return to game",
      exact: true,
    })
    .click();
  await expect(saveState(page)).toHaveAttribute("data-active-save-id", id);
  await expect(
    page.getByRole("button", { name: "pause", exact: true }).first(),
  ).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(saveState(page)).toHaveAttribute("data-active-save-id", id);
  expect((await readSavedGame(page, id))!.dollarsPerkWh).toBe(continuedRate);
  expect(
    (await readSaveRecords(page)).find((record) => record.metadata.id === id)!
      .metadata.status,
  ).toBe("completed");
});

test("Cancel after a delayed source-save failure allows the paused clock to restart", async ({
  page,
}) => {
  const id = await startGame(page);
  await page
    .getByRole("button", { name: "normal speed", exact: true })
    .first()
    .click();
  await holdWriterTransactions(page);
  await setStorageFault(page, true);
  await saveAndQuit(page);
  await expect(
    page.getByRole("dialog", { name: "Saving your game" }),
  ).toBeVisible();
  const failure = page.getByRole("dialog", {
    name: "Your game could not be saved",
  });
  await expect(failure).toBeVisible();
  const exported = await exportedFile(
    page,
    failure.getByRole("button", { name: "Export current game", exact: true }),
  );
  await failure.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(failure).toBeHidden();
  const clock = page.locator("#appbar:visible .gameStatusValue.weak");
  const before = await clock.innerText();
  await page
    .getByRole("button", { name: "fast speed", exact: true })
    .first()
    .click();
  // Phones show only month/year, so advance until even that clock visibly changes.
  await expect(clock).not.toHaveText(before);
  await page
    .getByRole("button", { name: "pause", exact: true })
    .first()
    .click();
  await setStorageFault(page, false);
  const resumed = (await readSavedGame(page, id))!;
  expect(resumed.date.minute).toBeGreaterThan(
    exported.file.save.game.date.minute,
  );
});
