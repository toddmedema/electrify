import { expect, test } from "@playwright/test";
import { openPane } from "./layout";

for (const theme of ["light", "dark"] as const) {
  test(`short panes keep the fleet and trading controls reachable in ${theme}`, async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "foldable-unfolded");
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
    }, theme);
    await page.goto("/?scenario=100");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const facilities = page.locator(".facilities:visible").last();
    await facilities
      .getByRole("button", { name: "Build", exact: true })
      .click();
    await page.getByRole("tab", { name: "Interties", exact: true }).click();
    await page
      .getByRole("button", {
        name: "Review purchase of Pacific Northwest intertie",
        exact: true,
      })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", {
        name: "Take loan",
        exact: true,
      })
      .click();

    await expect(facilities.locator(".transmissionLine")).toBeVisible();
    await expect(page.locator(".cardTransitions > main")).toHaveCount(1);
    for (const [width, height] of [
      [844, 690],
      [700, 600],
      [1280, 500],
      [1280, 600],
      [390, 844],
      [844, 690],
      [1280, 800],
    ]) {
      await page.setViewportSize({ width, height });
      // The compositor debounces viewport changes for 100ms before mounting the new layout.
      await page.waitForTimeout(150);
      await expect(page.locator(".cardTransitions > main")).toHaveCount(1);
      await openPane(
        facilities,
        page.getByRole("button", { name: "Facilities", exact: true }),
      );
      const trading = facilities.getByRole("combobox", {
        name: "Trading rule",
      });
      await trading.scrollIntoViewIfNeeded();
      await expect(trading).toBeInViewport({ ratio: 0.99 });
      const intertie = facilities
        .locator(".transmissionLine .facilityDisclosure")
        .last();
      await intertie.scrollIntoViewIfNeeded();
      await expect(intertie, `${width}x${height} intertie`).toBeInViewport({
        ratio: 0.99,
      });
      await intertie.click();
      await expect(intertie).toHaveAttribute("aria-expanded", "true");
      await intertie.click();
      const plant = facilities
        .locator(".facilityRow .facilityDisclosure")
        .first();
      await plant.scrollIntoViewIfNeeded();
      await expect(plant).toBeInViewport({ ratio: 0.99 });
      await plant.click();
      await expect(plant).toHaveAttribute("aria-expanded", "true");
      await plant.click();
      const body = facilities.locator(".facilitiesBody");
      if (height <= 690 || width === 390) {
        expect(
          await body.evaluate((element) => getComputedStyle(element).overflowY),
        ).toBe("auto");
        expect(
          await body.evaluate((element) => element.clientHeight),
        ).toBeGreaterThan(44);
      }
      expect(
        await body.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
      const chart = facilities.locator(".facilitySupplyChart");
      await chart.scrollIntoViewIfNeeded();
      await expect(chart).toBeInViewport();
      await expect(
        facilities.getByRole("button", { name: "Build", exact: true }),
      ).toBeInViewport();
    }
  });
}
