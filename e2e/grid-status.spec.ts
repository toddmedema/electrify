/* eslint-disable testing-library/prefer-screen-queries -- Playwright owns browser queries. */
import { expect, test } from "./fixtures";
import { reviewScreenshot } from "./review-screenshot";

for (const theme of ["light", "dark"] as const) {
  test(`grid status retains power and opens actionable diagnosis in ${theme}`, async ({
    page,
  }, info) => {
    test.setTimeout(120000);
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
      Math.random = () => 0.25;
    }, theme);
    await page.goto("/?scenario=116");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const status = page.getByRole("button", {
      name: /^Current grid status: NOW/,
    });
    await expect(status).toBeVisible();
    await expect(status).toContainText(/NOW.*\d.*MW.*reserve/);
    const power = status.locator(".gridStatusPower");
    await expect(power).toBeVisible();
    expect(
      await status.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    expect((await status.boundingBox())!.height).toBeGreaterThanOrEqual(
      info.project.use.hasTouch ? 44 : 40,
    );
    await status.click();
    const dialog = page.getByRole("dialog", {
      name: "Grid status",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: "Grid status", exact: true }),
    ).toBeFocused();
    await expect(dialog).toContainText(/Purchased power now: \d.*W total/);
    await expect(dialog).toContainText(/For customers: \d.*W.*% of supply/);
    await expect(dialog).toContainText("Under agreement:");
    await expect(dialog).toContainText(/Storage ready:|No storage ready/);
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(16);
    expect(box.x + box.width).toBeLessThanOrEqual(
      page.viewportSize()!.width - 16,
    );
    await reviewScreenshot(page, {
      path: info.outputPath(`grid-status-${theme}.png`),
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(status).toBeFocused();
    await reviewScreenshot(page.locator("#appbar"), {
      path: info.outputPath(`grid-status-header-${theme}.png`),
      animations: "disabled",
    });
    for (const [action, region] of [
      ["Manage fleet", "Fleet"],
      ["Manage agreements", "Agreements"],
      ["View supply forecast", "Insights"],
    ]) {
      await status.click();
      await dialog.getByRole("button", { name: action, exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(
        page.getByRole("region", { name: region, exact: true }),
      ).toBeVisible();
      await expect(page.locator(".gameToolPanel:visible")).toHaveCount(1);
    }
    await expect(page.locator("#chartForecastSupplyDemand")).toBeVisible();
  });

  test(`legacy grid status opens existing trading controls in ${theme}`, async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    // This authored legacy scenario starts with an operating intertie.
    await page.goto("/?scenario=111");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const status = page.getByRole("button", { name: /^Current grid status/ });
    const dialog = page.getByRole("dialog", {
      name: "Grid status",
      exact: true,
    });
    const controls = page.getByRole("region", { name: "Intertie management" });
    for (const choice of ["None", "Shortages + Charging"]) {
      await status.click();
      await dialog.getByRole("button", { name: "Manage agreements" }).click();
      await expect(dialog).toHaveCount(0);
      await expect(controls).toBeVisible();
      await expect(controls).toBeFocused();
      await expect(controls).toBeInViewport();
      await expect(
        page.getByRole("region", { name: "Build", exact: true }),
      ).toHaveCount(0);
      const buying = controls.getByRole("combobox", {
        name: "Buying",
        exact: true,
      });
      await buying.click();
      await page.getByRole("option", { name: choice, exact: true }).click();
      await expect(buying).toContainText(choice);
      await expect(
        controls.getByRole("combobox", { name: "Selling", exact: true }),
      ).toBeVisible();
    }
    // An island without external access has no management destination to offer.
    await page.goto("/?scenario=105");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    await status.click();
    await expect(
      dialog.getByRole("button", { name: "Manage agreements" }),
    ).toHaveCount(0);
  });
}
