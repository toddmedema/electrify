import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"]) {
  test(`customer programs can be explored, scheduled and cancelled in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
    }, theme);
    await page.goto("/?scenario=106");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const insights = page.locator(".insights:visible");
    if (!(await insights.isVisible()))
      await page.getByRole("button", { name: "Insights", exact: true }).click();
    const entry = insights.getByRole("button", {
      name: "Customer programs",
      exact: true,
    });
    await entry.click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByRole("button", { name: "Rooftop solar rebates · Off" })
      .click();
    await expect(dialog).toContainText(
      "does not directly cover an evening peak",
    );
    const apply = dialog.getByRole("button", { name: "Apply next month" });
    await expect(apply).toBeDisabled();
    await dialog.getByRole("radio", { name: /^Off/ }).focus();
    await page.keyboard.press("ArrowDown");
    await expect(dialog.getByRole("radio", { name: /^Small/ })).toBeChecked();
    await expect(apply).toBeEnabled({ timeout: 30000 });
    await expect(dialog).toContainText("Peak demand:");
    await expect(dialog).toContainText("Charges start Feb 2020");
    await page.keyboard.press("g");
    await expect(dialog).toBeVisible();
    await expect(page.locator(".buildOption")).toHaveCount(0);
    expect(
      await dialog.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath(`program-${theme}.png`),
    });
    await dialog.getByText(/^Peak demand:/).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`comparison-${theme}.png`),
    });
    await dialog.getByRole("button", { name: "After 12 months" }).click();
    await expect(apply).toBeEnabled({ timeout: 30000 });
    await expect(dialog).toContainText("Estimated utility demand · Jan 2021");
    await dialog.getByRole("button", { name: "First effective month" }).click();
    await expect(apply).toBeEnabled({ timeout: 30000 });
    await apply.click();
    await expect(dialog).toContainText("Small starts Feb 2020");
    await dialog
      .getByRole("button", { name: "Rooftop solar rebates · Off" })
      .click();
    await dialog.getByRole("radio", { name: /^Large/ }).check();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toContainText("Small starts Feb 2020");
    await dialog
      .getByRole("button", { name: "Rooftop solar rebates · Off" })
      .click();
    await dialog
      .getByRole("button", { name: "Cancel scheduled change" })
      .click();
    await expect(dialog).not.toContainText("Small starts");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(entry).toBeFocused();
  });
}
