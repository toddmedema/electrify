import { expectDialogToFit } from "./dialog-layout";
import { expect, test } from "./fixtures";

for (const theme of ["light", "dark"] as const) {
  test(`scenario tool reflows and dismisses in ${theme} mode`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((mode) => {
      window.localStorage.clear();
      window.localStorage.setItem("theme", mode);
      window.localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=111");
    await page.getByRole("button", { name: "Start game" }).click();
    // The dock's Scenario tool is the way into the full requirements
    const details = page
      .locator("#navfooter:visible")
      .getByRole("button", { name: "Scenario", exact: true })
      .first();
    await details.click();
    const panel = page.getByRole("region", { name: "Scenario", exact: true });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("Wildfire Emergency");
    await expect(
      panel.locator(
        '.missionRequirementStatus[data-status="unknown"], .missionRequirementStatus[data-status="in-progress"]',
      ),
    ).toHaveCount(0);
    await expect(panel).not.toContainText("(partial month)");
    await expect(panel).toBeInViewport({ ratio: 1 });
    await expectDialogToFit(panel);
    await expect(
      panel.getByText(/Score appears after your first month/),
    ).toBeAttached();
    // Like every other tool, it leaves the action bar in place
    await expect(details).toBeInViewport();
    const close = panel.getByRole("button", { name: "Close Scenario" });
    await expect(close).toBeInViewport();
    expect(
      await panel.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    const box = await close.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(
      testInfo.project.use.hasTouch ? 44 : 40,
    );
    await close.click();
    await expect(panel).not.toBeVisible();
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
    const score = panel.getByRole("region", { name: "Score breakdown" });
    await expect(score).not.toContainText(
      "Score appears after your first month.",
    );
    await expect(score.getByText(/points per/).first()).toBeAttached();
    await expect(
      panel.getByRole("region", { name: "Score outlook" }),
    ).toContainText("Projected final");
    await expect(panel).toBeInViewport({ ratio: 1 });
    await expectDialogToFit(panel);
    await page.keyboard.press("Escape");
    await expect(panel).not.toBeVisible();
    await details.click();
    await expect(panel).toBeVisible();
    await details.click();
    await expect(panel).not.toBeVisible();
  });
}
