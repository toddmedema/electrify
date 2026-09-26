import { expect, test } from "@playwright/test";
import { openPane } from "./layout";

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
    await openPane(
      insights,
      page.getByRole("button", { name: "Insights", exact: true }),
    );
    const entry = insights.getByRole("button", {
      name: "Customer programs",
      exact: true,
    });
    await entry.click();
    const dialog = page.getByRole("dialog");
    const solar = dialog.getByRole("button", {
      name: "Rooftop solar rebates · Not started",
    });
    await solar.click();
    await expect(dialog).toContainText(
      "does not directly cover an evening peak",
    );
    await expect(dialog).toContainText("24 months of installations");
    await expect(dialog.getByRole("radio")).toHaveCount(0);
    const apply = dialog.getByRole("button", {
      name: "Start build-out next month",
    });
    await expect(apply).toBeEnabled({ timeout: 30000 });
    await expect(dialog).toContainText("Peak demand:");
    await expect(dialog.getByText(/^Electricity supplied:/)).toBeVisible();
    await expect(dialog.getByText(/^Change in utility cash/)).toBeVisible();
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
    await dialog
      .getByRole("button", { name: "At completion (Jan 2022)" })
      .click();
    await expect(apply).toBeEnabled({ timeout: 30000 });
    await expect(dialog).toContainText("Estimated utility demand · Jan 2022");
    await dialog.getByRole("button", { name: "First effective month" }).click();
    await expect(apply).toBeEnabled({ timeout: 30000 });
    await apply.click();
    await expect(dialog).toContainText("Starts Feb 2020");
    await solar.click();
    await expect(
      dialog.getByRole("button", { name: "Cancel scheduled start" }),
    ).toBeEnabled({ timeout: 30000 });
    await dialog.getByRole("button", { name: "Back", exact: true }).click();
    await expect(dialog).toContainText("Starts Feb 2020");
    await solar.click();
    await dialog
      .getByRole("button", { name: "Cancel scheduled start" })
      .click();
    await expect(dialog).not.toContainText("Starts Feb 2020");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(entry).toBeFocused();
  });
}
