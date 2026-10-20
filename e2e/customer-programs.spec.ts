import { expect, test } from "./fixtures";

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
    const entry = page.getByRole("button", {
      name: "Programs",
      exact: true,
    });
    await entry.click();
    const dialog = page.getByRole("region", { name: "Programs", exact: true });
    const header = dialog.locator(".gameToolHeader");
    await expect(
      header.getByRole("button", { name: "Close Programs", exact: true }),
    ).toBeVisible();
    expect(
      await header.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    const solar = dialog.getByRole("button", {
      name: /^Rooftop solar rebates · Not started/,
    });
    const scheduled = dialog.getByRole("button", {
      name: "Rooftop solar rebates · Not started · starts Feb 2020",
    });
    await solar.click();
    await expect(dialog.getByText("How it works")).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: "View demand" }),
    ).toHaveCount(0);
    await expect(dialog).toContainText("they do not cover evening peaks");
    await expect(dialog).toContainText("Facility comparable");
    await expect(dialog).toContainText("/mo profit)");
    await expect(dialog).toContainText("48 months (Jan 2024)");
    const facts = dialog.locator(".customerProgramFacts").first();
    expect(
      await facts.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    const term = (await facts.locator("dt").first().boundingBox())!;
    const value = (await facts.locator("dd").first().boundingBox())!;
    if (page.viewportSize()!.width < 600) {
      expect(value.x).toBeCloseTo(term.x, 0);
      expect(value.y).toBeGreaterThanOrEqual(term.y + term.height);
    } else {
      expect(value.x).toBeGreaterThan(term.x + term.width);
    }
    await expect(dialog.getByRole("radio")).toHaveCount(0);
    const apply = dialog.getByRole("button", {
      name: "Start next month",
    });
    await expect(apply).toBeEnabled({ timeout: 30000 });
    const backBounds = (await dialog
      .locator(".customerProgramsActions")
      .getByRole("button", { name: "Back", exact: true })
      .boundingBox())!;
    const applyBounds = (await apply.boundingBox())!;
    expect(applyBounds.y).toBeCloseTo(backBounds.y, 0);
    expect(applyBounds.height).toBeCloseTo(backBounds.height, 0);
    await expect(dialog).toContainText("Peak demand:");
    await expect(dialog.getByText(/^Electricity supplied:/)).toBeVisible();
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
    // The estimate always shows the end of the program, so no toggle is needed.
    await expect(dialog).toContainText("Estimated demand · Jan 2024");
    await expect(apply).toBeEnabled({ timeout: 30000 });
    await apply.click();
    await expect(scheduled).toBeVisible();
    await solar.click();
    await expect(
      dialog.getByRole("button", { name: "Cancel scheduled start" }),
    ).toBeEnabled({ timeout: 30000 });
    await dialog
      .locator(".customerProgramsActions")
      .getByRole("button", { name: "Back", exact: true })
      .click();
    await expect(scheduled).toBeVisible();
    await solar.click();
    await dialog
      .getByRole("button", { name: "Cancel scheduled start" })
      .click();
    await expect(dialog).not.toContainText("starts Feb 2020");
    await expect(scheduled).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(entry).toBeFocused();
  });
}
