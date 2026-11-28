/* eslint-disable testing-library/prefer-screen-queries -- Playwright owns browser queries. */
import { SIDE_TOOL_MIN_WIDTH } from "../src/Globals";
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
      dialog.getByRole("button", { name: "View supply forecast" }),
    ).toBeFocused();
    await expect(
      dialog.getByRole("heading", { name: "Now · Stable" }),
    ).toBeVisible();
    await expect(dialog).toContainText(/\d.*MW reserve/);
    await expect(dialog).not.toContainText(/imported for customers/);
    await expect(dialog).toContainText(/Projected reliability risk in/, {
      timeout: 60_000,
    });
    await expect(dialog).toContainText(/About [\d.,]+[kMGT]?Wh unmet/);
    await expect(dialog).toContainText(/[\d.,]+[kMGT]?W peak shortfall at/);
    await expect(
      dialog.getByRole("button", { name: "View supply forecast" }),
    ).toHaveClass(/MuiButton-contained/);
    expect(
      await dialog.evaluate(
        (el) =>
          el.scrollWidth <= el.clientWidth &&
          el.scrollHeight <= el.clientHeight,
      ),
    ).toBe(true);
    for (const button of await dialog.getByRole("button").all()) {
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(
        info.project.use.hasTouch ? 44 : 40,
      );
    }
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(16);
    expect(box.x + box.width).toBeLessThanOrEqual(
      page.viewportSize()!.width - 16,
    );
    await reviewScreenshot(dialog, {
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
    const floating = page.viewportSize()!.width >= SIDE_TOOL_MIN_WIDTH;
    const destinations = [
      ["Manage fleet", "Fleet"],
      ["Manage agreements", "Agreements"],
      ["View supply forecast", "Insights"],
    ];
    for (const [index, [action, region]] of destinations.entries()) {
      await status.click();
      await dialog.getByRole("button", { name: action, exact: true }).click();
      await expect(dialog).toHaveCount(0);
      const panel = page.getByRole("region", { name: region, exact: true });
      await expect(panel).toBeVisible();
      await expect(panel).toHaveAttribute("data-map-window-front", "true");
      await expect(page.locator(".gameToolPanel:visible")).toHaveCount(
        floating ? index + 1 : 1,
      );
    }
    const forecast = page
      .getByRole("region", { name: "Insights", exact: true })
      .getByRole("region", { name: "Supply & Demand evidence", exact: true });
    // Insights opens before the long-range forecast worker has finished.
    await expect(
      forecast.getByRole("img", {
        name: /^Monthly ranges of estimated electricity supply and demand/,
      }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(forecast.locator("#chartForecastSupplyDemand")).toBeVisible();
  });

  test(`legacy grid status opens existing trading controls in ${theme}`, async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.emulateMedia({ reducedMotion: "no-preference" });
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
      await dialog.getByRole("button", { name: "Manage interties" }).click();
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
      await expect(page.locator(".facilitySupplyChart .uplot")).toBeVisible();
      await expect(buying).toBeInViewport();
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
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("button", {
        name: /Manage agreements|Manage interties/,
      }),
    ).toHaveCount(0);
  });
}
