import { expectDialogToFit } from "./dialog-layout";
import { expect, test } from "./fixtures";

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
    // The dock's scenario action is the way into the full requirements
    const details = page
      .locator("#navfooter:visible")
      .getByRole("button", { name: "Scenario & score" })
      .first();
    await details.click();
    const dialog = page.getByRole("dialog", { name: "Wildfire Emergency" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.locator(
        '.missionRequirementStatus[data-status="unknown"], .missionRequirementStatus[data-status="in-progress"]',
      ),
    ).toHaveCount(0);
    await expect(dialog).not.toContainText("(partial month)");
    await expectDialogToFit(dialog);
    await expect(
      dialog.getByText(/Score appears after your first month/),
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
    // Scoring needs one completed month, not the wildfire event 35 months later.
    // Observe the real clock crossing the boundary without depending on event-pane layout.
    const appbar = page.locator("#appbar:visible").first();
    await expect(appbar).toContainText(/Jan \d{4}/);
    await appbar
      .getByRole("button", { name: "fast speed", exact: true })
      .click();
    await expect(appbar).toContainText(/Feb \d{4}/);
    await page
      .locator("#appbar:visible")
      .getByRole("button", { name: "pause", exact: true })
      .first()
      .click();
    await details.click();
    const score = dialog.getByRole("region", { name: "Current score" });
    await expect(score).not.toContainText(
      "Score appears after your first month.",
    );
    await expect(score.getByText(/points per/).first()).toBeAttached();
    await expectDialogToFit(dialog);
    const content = dialog.locator(".MuiDialogContent-root");
    expect(
      await content.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    await dialog
      .getByRole("heading", { name: "Current score" })
      .scrollIntoViewIfNeeded();
    await expect(back).toBeInViewport();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await details.click();
    await dialog
      .getByRole("button", { name: "Close scenario details" })
      .click();
    await expect(dialog).not.toBeVisible();
  });
}
