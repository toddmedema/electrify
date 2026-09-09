import { expect, test } from "@playwright/test";

for (const theme of ["light", "dark"]) {
  test(`investment sandbox works on this viewport in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
    }, theme);
    await page.goto("/?scenario=106");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    if (!(await page.locator("#facilitiesPane").isVisible()))
      await page
        .getByRole("button", { name: "Facilities", exact: true })
        .click();
    await page.locator(".button-buildGenerator").click();
    await page
      .getByRole("button", { name: "Test an investment plan", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Test an investment plan",
    });
    await expect(dialog).toContainText("Game paused. Planning from");
    await dialog
      .getByRole("combobox", { name: "Facility", exact: true })
      .click();
    await page.getByRole("option", { name: /Solar/ }).first().click();
    await dialog.getByRole("spinbutton").fill("1");
    await dialog.getByRole("combobox", { name: "Payment" }).click();
    await page.getByRole("option", { name: /Loan/ }).click();
    await dialog.getByRole("button", { name: "Add to plan (0/8)" }).click();
    await dialog.getByRole("combobox", { name: "Asset type" }).click();
    await page.getByRole("option", { name: "Storage", exact: true }).click();
    await dialog
      .getByRole("combobox", { name: "Facility", exact: true })
      .click();
    await page.getByRole("option", { name: "Battery", exact: true }).click();
    await dialog.getByRole("combobox", { name: "Payment" }).click();
    await page.getByRole("option", { name: /Loan/ }).click();
    await dialog.getByRole("button", { name: "Add to plan (1/8)" }).click();
    await expect(
      dialog.getByRole("region", { name: "Proposed purchases" }),
    ).toContainText("Battery");
    await dialog
      .getByRole("button", { name: "Compare plan", exact: true })
      .click();
    const comparison = dialog.getByRole("region", {
      name: "Investment comparison",
    });
    await expect(comparison).toBeVisible({ timeout: 60000 });
    await expect(comparison).toContainText("Ending net worth (includes debt)");
    expect(
      await dialog.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    for (const button of await dialog.getByRole("button").all())
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await comparison.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`investment-${theme}.png`),
    });
    await dialog.getByRole("button", { name: /Remove purchase 2/ }).click();
    await expect(comparison).toHaveCount(0);
    await dialog.getByRole("button", { name: "Close sandbox" }).click();
    await expect(dialog).toHaveCount(0);
    await page
      .getByRole("button", { name: "Test an investment plan", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Proposed purchases" }),
    ).toHaveCount(0);
  });
}
