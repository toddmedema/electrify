import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"]) {
  test(`peak offers can be compared, scheduled and cancelled in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
    }, theme);
    await page.goto("/?scenario=106");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const insights = page.locator(".insights:visible");
    if (page.viewportSize()!.width >= 1400)
      await expect(insights).toBeVisible();
    else
      await page.getByRole("button", { name: "Insights", exact: true }).click();
    const entry = insights.getByRole("button", {
      name: "Customer programs",
      exact: true,
    });
    await entry.click();
    const dialog = page.getByRole("dialog");
    for (const offer of ["Time-of-use tariff", "Peak curtailment contracts"]) {
      await dialog
        .getByRole("button", { name: `${offer} · Off`, exact: true })
        .click();
      await expect(dialog).toContainText("17:00–21:00");
      await expect(dialog).toContainText("Base rate:");
      await expect(dialog).not.toContainText("installed upgrades");
      const large = dialog.getByRole("radio", { name: "Large · 50% enrolled" });
      await large.check();
      const apply = dialog.getByRole("button", {
        name: "Start next month",
        exact: true,
      });
      await expect(apply).toBeEnabled({ timeout: 30000 });
      await expect(dialog).toContainText("Peak demand:");
      await expect(dialog).toContainText("Change in utility cash");
      expect(
        await dialog.evaluate((el) => el.scrollWidth - el.clientWidth),
      ).toBeLessThanOrEqual(1);
      expect((await apply.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(
        (await large.locator("..").locator("..").boundingBox())!.height,
      ).toBeGreaterThanOrEqual(44);
      await dialog.getByRole("heading", { level: 2 }).scrollIntoViewIfNeeded();
      await dialog.locator(".MuiDialogContent-root").evaluate((el) => {
        el.scrollTop = 0;
      });
      await page.screenshot({
        path: testInfo.outputPath(
          `${offer === "Time-of-use tariff" ? "tariff" : "contract"}-${theme}.png`,
        ),
      });
      await dialog.getByText(/^Peak demand:/).scrollIntoViewIfNeeded();
      await page.screenshot({
        path: testInfo.outputPath(
          `${offer === "Time-of-use tariff" ? "tariff" : "contract"}-preview-${theme}.png`,
        ),
      });
      await apply.click();
      await expect(dialog).toContainText("Large starts Feb 2020");
      await dialog
        .getByRole("button", { name: `${offer} · Off`, exact: true })
        .click();
      await dialog
        .getByRole("button", { name: "Cancel scheduled change" })
        .click();
      await expect(dialog).not.toContainText("Large starts");
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(entry).toBeFocused();
  });
}
