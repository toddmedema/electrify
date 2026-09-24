import path from "path";
import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"]) {
  test(`victory actions remain usable and replay the scenario in ${theme}`, async ({
    page,
  }, info) => {
    await page.addInitScript((mode) => {
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=101");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    // Move a real save to its final tick to exercise the actual completed-run flow.
    await page.evaluate(() => {
      window.dispatchEvent(new Event("pagehide"));
      const save = JSON.parse(localStorage.getItem("savedGame")!);
      const offset = 144 * 1440 - 15 - save.game.date.minute;
      save.game.date.minute += offset;
      save.game.date.monthsElapsed = 143;
      for (const tick of save.game.timeline) tick.minute += offset;
      localStorage.setItem("savedGame", JSON.stringify(save));
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
    await expect(dialog.locator("..")).toHaveCSS("opacity", "1");
    const newGame = dialog.getByRole("button", {
      name: "New game",
      exact: true,
    });
    const replay = dialog.getByRole("button", { name: "Replay", exact: true });
    const newBox = (await newGame.boundingBox())!;
    const replayBox = (await replay.boundingBox())!;
    expect(replayBox.y).toBe(newBox.y);
    expect(replayBox.x).toBeGreaterThan(newBox.x + newBox.width);
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
    await replay.click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator("#appbar:visible").first()).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    const restarted = await page.evaluate(
      () => JSON.parse(localStorage.getItem("savedGame")!).game,
    );
    expect(restarted.scenarioId).toBe(101);
    expect(restarted.date.monthsElapsed).toBe(0);
  });
}
