import path from "path";
import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"] as const) {
  test(`scenario details reflow and dismiss in ${theme} mode`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((mode) => {
      window.localStorage.clear();
      window.localStorage.setItem("theme", mode);
      window.localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=111");
    await page.getByRole("button", { name: "Start game" }).click();
    const menu = page
      .locator("#appbar:visible")
      .getByRole("button", { name: "menu", exact: true })
      .first();
    await menu.click();
    await page.getByRole("menuitem", { name: "Scenario details" }).click();
    const dialog = page.getByRole("dialog", { name: "Wildfire Emergency" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText(/Your score will appear after the first month/),
    ).toBeAttached();
    const back = dialog.getByRole("button", { name: "Back to game" });
    await expect(back).toBeInViewport();
    await expect(
      dialog.getByRole("button", { name: "Close scenario details" }),
    ).toBeInViewport();
    expect(
      await dialog.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    const box = await back.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(
      testInfo.project.use.hasTouch ? 44 : 40,
    );
    await back.click();
    await expect(dialog).not.toBeVisible();
    await page.getByRole("button", { name: "Events", exact: true }).click();
    await page
      .locator("#appbar:visible")
      .getByRole("button", { name: "fast speed", exact: true })
      .first()
      .click();
    // Wait for a real completed month, then stop the clock before inspecting its score.
    await expect(
      page.getByText("Wildfire emergency", { exact: true }),
    ).toBeAttached({ timeout: 25000 });
    await page
      .locator("#appbar:visible")
      .getByRole("button", { name: "pause", exact: true })
      .first()
      .click();
    await menu.click();
    await page.getByRole("menuitem", { name: "Scenario details" }).click();
    await expect(
      dialog.getByText("Through last month · updates monthly"),
    ).toBeAttached();
    const content = dialog.locator(".MuiDialogContent-root");
    expect(
      await content.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    await dialog
      .getByRole("heading", { name: "Current score" })
      .scrollIntoViewIfNeeded();
    await expect(back).toBeInViewport();
    const reviewDir = process.env.REVIEW_SCREENSHOT_DIR;
    if (
      reviewDir &&
      (testInfo.project.name === "desktop-chromium" ||
        (theme === "dark" && testInfo.project.name === "mobile-390px"))
    ) {
      await content.evaluate((el) => {
        el.scrollTop = 0;
      });
      // Finish the dialog/menu transitions before capturing the review frame.
      await page.waitForTimeout(400);
      await page.screenshot({
        path: path.join(
          reviewDir,
          `scenario-details-${testInfo.project.name}-${theme}.png`,
        ),
      });
    }
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
  });
}
