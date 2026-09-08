import path from "path";
import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"] as const) {
  test(`simulation assumptions support decisions in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
      localStorage.setItem("insightsLayers", JSON.stringify(["fuelPrices"]));
    }, theme);
    await page.goto("/?scenario=100");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    await expect(page.getByRole("group", { name: "game speed" })).toBeVisible();
    const insights = page.locator(".insights:visible");
    if (!(await insights.isVisible()))
      await page.getByRole("button", { name: "Insights", exact: true }).click();
    const scope = insights
      .locator("details")
      .filter({ hasText: "Estimates · one representative day per month" });
    await scope.locator("summary").click();
    await expect(scope).toContainText("cannot establish whether storage");
    await expect(scope).toContainText("Deep Freeze and Heatwave + Drought");
    await scope.locator("summary").click();
    const costs = insights
      .locator("details")
      .filter({ hasText: "Compare possible costs in five years" });
    await costs.locator("summary").click();
    await expect(costs).toContainText("no assigned probability");
    await expect(costs.getByText(/Prime borrowing rate:/)).toHaveCount(3);
    expect(
      await costs.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    const reviewDir = process.env.REVIEW_SCREENSHOT_DIR;
    if (
      reviewDir &&
      theme === "light" &&
      testInfo.project.name === "desktop-chromium"
    ) {
      await costs.scrollIntoViewIfNeeded();
      // Finish the view transition before capturing the review frame.
      await page.waitForTimeout(400);
      await page.screenshot({
        path: path.join(reviewDir, "desktop-cost-assumptions-light.png"),
      });
    }
    const facilities = page.locator(".facilities:visible");
    if (!(await facilities.isVisible()))
      await page
        .getByRole("button", { name: "Facilities", exact: true })
        .click();
    await facilities.locator(".button-buildGenerator").click();
    const first = page.locator(".buildOption").first();
    await first.getByRole("button", { name: /Show .* details/ }).click();
    await expect(first).toContainText("automatically retire at this age");
    await first.getByRole("button", { name: /Review purchase of/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Loan option");
    await expect(dialog).toContainText("Payments start during construction");
    await expect(dialog).toContainText("Estimated upkeep");
    expect(
      await dialog.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    await expect(
      dialog.getByRole("button", { name: "Take loan", exact: true }),
    ).toBeInViewport();
    if (
      reviewDir &&
      theme === "dark" &&
      testInfo.project.name === "mobile-390px"
    ) {
      // Finish the view transition before capturing the review frame.
      await page.waitForTimeout(400);
      await page.screenshot({
        path: path.join(reviewDir, "mobile-loan-review-dark.png"),
      });
    }
    await dialog.getByRole("button", { name: "close", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await page.getByRole("button", { name: "close", exact: true }).click();
    await facilities.getByRole("tab", { name: "Interties" }).click();
    const trade = facilities
      .locator("details")
      .filter({ hasText: "How trading and purchased emissions are estimated" });
    expect(
      (await trade.locator("summary").boundingBox())!.height,
    ).toBeGreaterThanOrEqual(44);
    await trade.locator("summary").click();
    await expect(trade).toContainText("imports are not guaranteed backup");
    await expect(trade).toContainText(
      "carbon fee applies to your local plants",
    );
    await expect(
      trade.getByRole("link", { name: /Source for/ }).first(),
    ).toHaveAttribute("href", /https:\/\//);
    expect(
      await facilities.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    if (
      reviewDir &&
      theme === "light" &&
      testInfo.project.name === "mobile-390px"
    ) {
      await trade.scrollIntoViewIfNeeded();
      // Finish the view transition before capturing the review frame.
      await page.waitForTimeout(400);
      await page.screenshot({
        path: path.join(reviewDir, "mobile-intertie-assumptions-light.png"),
      });
    }
  });
}
