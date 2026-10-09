import { editSavedGame, readSavedGame } from "./save-fixture";
import { expectDialogToFit } from "./dialog-layout";
import path from "path";
import { expect, test } from "./fixtures";

for (const theme of ["light", "dark"]) {
  test(`victory actions remain usable and replay the scenario in ${theme}`, async ({
    page,
  }, info) => {
    await page.addInitScript((mode) => {
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=101");
    await page.getByRole("button", { name: "Hard", exact: true }).click();
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    await expect(page.locator("#appbar:visible").first()).toBeVisible();
    // Move a real save to its final tick to exercise the actual completed-run flow.
    await editSavedGame(page, (save) => {
      const offset = 144 * 1440 - 15 - save.game.date.minute;
      save.game.date.minute += offset;
      save.game.date.monthsElapsed = 143;
      for (const tick of save.game.timeline) tick.minute += offset;
      // Every difficulty now requires at least one meaningful decision to win.
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
    });
    await page.reload();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page
      .locator("#appbar:visible")
      .getByRole("button", { name: "normal speed", exact: true })
      .first()
      .click();
    const dialog = page.getByRole("dialog", { name: "Mission complete" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText("Rise of Renewables · Hard", { exact: true }),
    ).toBeVisible();
    await expect(
      dialog
        .getByRole("region", { name: "Mission results" })
        .getByText("Demand served", { exact: true }),
    ).toBeVisible();
    await expect(dialog.locator("..")).toHaveCSS("opacity", "1");
    await expectDialogToFit(dialog);
    const newGame = dialog.getByRole("button", {
      name: "New game",
      exact: true,
    });
    const replay = dialog.getByRole("button", { name: "Replay", exact: true });
    const newBox = (await newGame.boundingBox())!;
    const replayBox = (await replay.boundingBox())!;
    expect(replayBox.y).toBe(newBox.y);
    expect(newBox.x).toBeGreaterThan(replayBox.x + replayBox.width);
    expect(
      await dialog.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    for (const button of await dialog
      .locator(".victoryDialogActions button")
      .all()) {
      const box = (await button.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(
        info.project.use.hasTouch ? 44 : 40,
      );
      expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    }
    if (process.env.REVIEW_SCREENSHOT_DIR) {
      await page.mouse.move(0, 0);
      await page.screenshot({
        path: path.join(
          process.env.REVIEW_SCREENSHOT_DIR,
          `victory-${info.project.name}-${theme}.png`,
        ),
      });
    }
    await dialog
      .getByRole("button", { name: /Challenge a friend|Share result/ })
      .click();
    const preview = page.getByRole("dialog", {
      name: /Challenge a friend|Share result/,
    });
    await expectDialogToFit(preview);
    await preview.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(preview).toHaveCount(0);
    await replay.click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator("#appbar:visible").first()).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    const restarted = (await readSavedGame(page))!;
    expect(restarted.scenarioId).toBe(101);
    expect(restarted.difficulty).toBe("VP");
    expect(restarted.date.monthsElapsed).toBe(0);
  });
}

test("retrying a failed scenario keeps its difficulty in the game and mission details", async ({
  page,
}, info) => {
  const theme = info.project.use.hasTouch ? "dark" : "light";
  await page.addInitScript((mode) => {
    localStorage.setItem("audioEnabled", "false");
    localStorage.setItem("theme", mode);
  }, theme);
  await page.goto("/?scenario=101");
  await page.getByRole("button", { name: "Expert", exact: true }).click();
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  const requirements = page
    .locator("#appbar:visible")
    .getByRole("button", { name: "All requirements" })
    .first();
  const details = page.getByRole("dialog", { name: "Rise of Renewables" });
  await requirements.click();
  await expect(details.getByText("Expert", { exact: true })).toBeVisible();
  await details.getByRole("button", { name: "Back to game" }).click();

  // Force insolvency at the next month boundary through a real saved game.
  await editSavedGame(page, (save) => {
    const offset = 1440 - 15 - save.game.date.minute;
    save.game.date.minute += offset;
    for (const tick of save.game.timeline) {
      tick.minute += offset;
      tick.cash = -1000000000;
    }
  });
  await page.reload();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  // Restoring negative cash first offers the existing last chance to change rates.
  await page.getByRole("button", { name: "Go bankrupt", exact: true }).click();
  await page
    .locator("#appbar:visible")
    .getByRole("button", { name: "normal speed", exact: true })
    .first()
    .click();
  const failure = page.getByRole("dialog", { name: "Bankrupt!" });
  await expect(failure).toBeVisible();
  await failure.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(failure).not.toBeVisible();
  await expect(page.locator("#appbar:visible").first()).toBeVisible();

  const restarted = (await readSavedGame(page))!;
  expect(restarted.scenarioId).toBe(101);
  expect(restarted.difficulty).toBe("CEO");
  expect(restarted.date.monthsElapsed).toBe(0);
  await requirements.click();
  await expect(details.getByText("Expert", { exact: true })).toBeVisible();
  if (process.env.REVIEW_SCREENSHOT_DIR) {
    await expect(details.locator("..")).toHaveCSS("opacity", "1");
    await page.mouse.move(0, 0);
    await page.screenshot({
      path: path.join(
        process.env.REVIEW_SCREENSHOT_DIR,
        `retry-difficulty-${info.project.name}-${theme}.png`,
      ),
    });
  }
});
