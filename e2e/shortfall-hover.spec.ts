import { expect, test } from "./fixtures";
import { openPane } from "./layout";
import { editSavedGame, readSavedGame } from "./save-fixture";
import { reviewScreenshot } from "./review-screenshot";

for (const theme of ["light", "dark"]) {
  test(`shortage hover selects the full interval in ${theme}`, async ({
    page,
  }, info) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=108");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    await expect.poll(async () => !!(await readSavedGame(page))).toBe(true);
    await editSavedGame(page, (save) => {
      save.game.speed = "PAUSED";
      save.game.timeline.forEach((tick) => {
        const hour = (tick.minute % 1440) / 60;
        tick.supplyByFuel = { Coal: 600e6 };
        tick.storageDischargeW = 0;
        tick.storageChargeW = 0;
        tick.importedW = 0;
        tick.exportedW = 0;
        tick.customerBatteryGridChargeW = 0;
        tick.supplyW = 600e6;
        tick.demandW =
          hour <= 6 || hour >= 18 ? 500e6 : hour === 12 ? 900e6 : 750e6;
      });
    });
    await page.reload();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    const pane = page.locator(".facilities:visible");
    await openPane(
      pane,
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    const chart = pane.locator("#chartSupplyDemand");
    const over = chart.locator(".u-over");
    await expect(over).toBeVisible();
    await over.scrollIntoViewIfNeeded();
    const box = (await over.boundingBox())!;
    const highlight = chart.locator(".chartShortfallHighlight");
    for (const height of [0.05, 0.95]) {
      await page.mouse.move(box.x + box.width / 3, box.y + box.height * height);
      await expect(highlight).toBeVisible();
      const selected = (await highlight.boundingBox())!;
      expect(selected.width).toBeGreaterThan(box.width * 0.45);
      expect(selected.height).toBeCloseTo(box.height, 0);
      await expect(chart.locator(".chartTooltip")).toContainText(
        "Unmet demand: 150MW",
      );
      await expect(chart.locator(".chartTooltip")).toContainText(
        "Peak shortfall: 300MW",
      );
    }
    const heading = chart.locator(".chartTooltip > div").first();
    await expect(heading).toContainText("Peak shortfall: 300MW");
    const headingBox = (await heading.boundingBox())!;
    const tooltipBox = (await chart.locator(".chartTooltip").boundingBox())!;
    expect(headingBox.y + headingBox.height).toBeLessThanOrEqual(
      tooltipBox.y + tooltipBox.height,
    );
    await reviewScreenshot(page, {
      path: info.outputPath(`shortage-${theme}.png`),
      animations: "disabled",
    });
    await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.5);
    await expect(highlight).toBeHidden();
    await expect(chart.locator(".chartTooltip")).not.toContainText(
      "Unmet demand:",
    );
    // Keyboard inspection selects the same interval and Escape clears it.
    const keyboardChart = chart.getByRole("img");
    await keyboardChart.focus();
    await keyboardChart.press("Home");
    for (let i = 0; i < 32; i++) await keyboardChart.press("ArrowRight");
    await expect(highlight).toBeVisible();
    await keyboardChart.press("Escape");
    await expect(highlight).toBeHidden();
    await pane
      .getByRole("button", { name: "Inspect Battery", exact: true })
      .click();
    const battery = pane.locator(
      '.facilityRow[data-facility="Battery"] .facilityDetails',
    );
    await expect(battery).toContainText("80% capacity");
    await expect(battery).toContainText("Continues operating after that");
    await reviewScreenshot(battery, {
      path: info.outputPath(`battery-${theme}.png`),
      animations: "disabled",
    });
  });
}
