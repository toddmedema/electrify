import path from "path";
import { expect, test, Page } from "./fixtures";
import { decodeSave } from "../src/SaveEncoding";
import type { SaveGameType } from "../src/Types";
import { copySavedGame, readSavedGame, readSaveRecords } from "./save-fixture";

async function startGame(page: Page) {
  await page.goto("/?scenario=101");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(page.locator("#appbar:visible")).toBeVisible();
  await expect.poll(async () => (await readSaveRecords(page)).length).toBe(1);
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

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("audioEnabled", "false"));
});

test("an independent local copy preserves compact save data and resumes paused", async ({
  page,
}) => {
  await startGame(page);
  await openSaves(page);
  const original = (await readSaveRecords(page))[0];
  const originalId = original.metadata.id;
  const wire = original.save as {
    game: { timeline: { shapes: unknown[]; rows: unknown[] } };
  };
  expect(wire.game.timeline.shapes.length).toBeGreaterThan(0);
  expect(wire.game.timeline.rows).toHaveLength(96);
  const exported = decodeSave(original.save) as SaveGameType;
  await copySavedGame(page, originalId);
  await expect(page.locator("article.saveEntry")).toHaveCount(2);
  const records = await readSaveRecords(page);
  const imported = records.find((record) => record.metadata.id !== originalId)!;
  expect(imported.metadata.lastPlayedAt).toBeUndefined();
  const importedRow = page.locator(`[data-save-id="${imported.metadata.id}"]`);
  await importedRow.getByRole("button", { name: "Load", exact: true }).click();
  await expect(page.locator("#appbar:visible")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "pause", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const restored = (await readSavedGame(page))!;
  expect(restored.date).toEqual(exported.game.date);
  expect(restored.facilities).toEqual(exported.game.facilities);
  expect(restored.timeline).toEqual(exported.game.timeline);
  expect(restored.monthlyHistory).toEqual(exported.game.monthlyHistory);
});

for (const theme of ["light", "dark"]) {
  test(`save management preserves independent copies and fits in ${theme}`, async ({
    page,
  }, info) => {
    await page.addInitScript(
      (mode) => localStorage.setItem("theme", mode),
      theme,
    );
    await startGame(page);
    await openSaves(page);
    const original = (await readSaveRecords(page))[0];
    const originalRow = page.locator(
      `[data-save-id="${original.metadata.id}"]`,
    );
    await expect(page.getByText(/Currently open/)).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /^(Return to game|Resume)$/ }),
    ).toHaveCount(0);
    const liveGame = await readSavedGame(page, original.metadata.id);
    await originalRow
      .getByRole("button", { name: "Load", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "menu", exact: true }),
    ).toBeFocused();
    expect(await readSavedGame(page, original.metadata.id)).toEqual(liveGame);
    expect(await readSaveRecords(page)).toHaveLength(1);
    await openSaves(page);
    await originalRow.getByRole("button", { name: /^Actions for/ }).click();
    await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
    const rename = page.getByRole("dialog", { name: "Rename saved game" });
    await rename.getByRole("textbox", { name: "Save name" }).fill("   ");
    await rename.getByRole("button", { name: "Rename", exact: true }).click();
    await expect(rename.getByText(/Enter a name/)).toBeVisible();
    const name = "Renewables experiment ⚡ — a longer name for this strategy";
    await rename.getByRole("textbox", { name: "Save name" }).fill(name);
    await rename.getByRole("textbox", { name: "Save name" }).press("Enter");
    await expect(
      originalRow.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await copySavedGame(page, original.metadata.id);
    await expect(page.locator("article.saveEntry")).toHaveCount(2);
    const records = await readSaveRecords(page);
    const copy = records.find(
      (record) => record.metadata.id !== original.metadata.id,
    )!;
    const copyRow = page.locator(`[data-save-id="${copy.metadata.id}"]`);
    await copyRow.getByRole("button", { name: /^Actions for/ }).click();
    await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
    await rename
      .getByRole("textbox", { name: "Save name" })
      .fill("Low carbon utility");
    await rename.getByRole("textbox", { name: "Save name" }).press("Enter");
    await page
      .getByRole("textbox", { name: "Search saves" })
      .fill("Low carbon");
    await expect(page.locator("article.saveEntry")).toHaveCount(1);
    await page.getByRole("textbox", { name: "Search saves" }).fill("");
    await expect(page.locator("article.saveEntry")).toHaveCount(2);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    for (const button of await page.locator("article.saveEntry button").all()) {
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(
        info.project.use.hasTouch ? 44 : 40,
      );
    }
    if (
      process.env.REVIEW_SCREENSHOT_DIR &&
      ((theme === "light" && info.project.name === "desktop-chromium") ||
        (theme === "dark" && info.project.name === "mobile-390px"))
    ) {
      const dismissNotice = page
        .getByRole("alert")
        .getByRole("button", { name: "Close", exact: true });
      if (await dismissNotice.count()) await dismissNotice.click();
      await page
        .getByRole("heading", { name: "Saved games", exact: true })
        .click();
      await page.mouse.move(0, 0);
      await page.screenshot({
        path: path.join(
          process.env.REVIEW_SCREENSHOT_DIR,
          `saves-${info.project.name}-${theme}.png`,
        ),
        animations: "disabled",
      });
    }
    await copyRow.getByRole("button", { name: /^Actions for/ }).click();
    await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
    const deleting = page.getByRole("dialog", { name: "Delete saved game?" });
    await expect(
      deleting.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(copyRow).toBeVisible();
    await copyRow.getByRole("button", { name: /^Actions for/ }).click();
    await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
    await deleting.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(copyRow).toHaveCount(0);
    await expect(originalRow).toBeVisible();
    await originalRow.getByRole("button", { name: /^Actions for/ }).click();
    await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
    await deleting.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Continue", exact: true }),
    ).toHaveCount(0);
    await expect.poll(async () => (await readSaveRecords(page)).length).toBe(0);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Continue", exact: true }),
    ).toHaveCount(0);
  });
}

test("another tab cannot resume the live save", async ({ page, context }) => {
  await startGame(page);
  const original = (await readSaveRecords(page))[0];
  const other = await context.newPage();
  await other.goto("/");
  await other.getByRole("button", { name: "Saved games", exact: true }).click();
  await other
    .locator(`[data-save-id="${original.metadata.id}"]`)
    .getByRole("button", { name: "Load", exact: true })
    .click();
  await expect(
    other
      .getByRole("dialog", { name: "Could not open this save" })
      .filter({ hasText: /another tab/ }),
  ).toBeVisible();
  await expect(page.locator("#appbar:visible")).toBeVisible();
  await expect(
    page.locator("#appbar:visible [data-save-state]").first(),
  ).toHaveAttribute("data-save-state", "saved");
  expect((await readSaveRecords(page))[0].metadata.id).toBe(
    original.metadata.id,
  );
});

test("a popup with copied session storage cannot take the writer token after reloading", async ({
  page,
}) => {
  await startGame(page);
  const popupPromise = page.waitForEvent("popup");
  await page.evaluate(() => window.open("/", "_blank"));
  const popup = await popupPromise;
  await popup.waitForLoadState();
  await popup.reload();
  await popup.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    popup.getByRole("dialog", { name: "Could not open this save" }),
  ).toContainText("another tab");
  await expect(popup.locator("#appbar:visible")).toHaveCount(0);
  await expect(page.locator("#appbar:visible")).toBeVisible();
});

test("the same tab can reload or navigate home and resume without waiting for lease expiry", async ({
  page,
}) => {
  await startGame(page);
  const original = (await readSaveRecords(page))[0];
  await page.reload();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator("#appbar:visible")).toBeVisible();
  await page.goto("/");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator("#appbar:visible")).toBeVisible();
  expect((await readSaveRecords(page))[0].metadata.id).toBe(
    original.metadata.id,
  );
  expect(await readSaveRecords(page)).toHaveLength(1);
});

test("legacy local storage does not create saves and file import is replaced", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("savedGame", '{"game":{"scenarioId":101}}'),
  );
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Saved games", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Manage saves", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No saved games yet" }),
  ).toBeVisible();
  await expect(page.getByLabel("Save game file")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Import", exact: true }),
  ).toHaveCount(0);
  expect(await readSaveRecords(page)).toHaveLength(0);
});
