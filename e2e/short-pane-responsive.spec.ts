import { expect, test } from "./fixtures";
import { openPane, openBuild } from "./layout";

test("a live resize switches tablet, foldable and desktop game controls", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop-chromium");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => localStorage.setItem("audioEnabled", "false"));
  await page.goto("/?scenario=106");
  await page.getByRole("button", { name: "Start game", exact: true }).click();

  const stage = page.locator(".gameStage");
  const events = page.locator("#eventsPane");
  const eventsButton = page
    .getByRole("navigation", { name: "Game actions" })
    .getByRole("button", { name: "Events", exact: true });
  const goals = events.getByRole("heading", { name: "Goals", exact: true });
  const ultra = page.getByRole("button", { name: "ultra speed", exact: true });

  for (const [width, height, layout, operations, wide] of [
    [768, 1024, "single", false, false],
    [844, 690, "single", true, false],
    [1280, 800, "side", true, false],
    [1440, 900, "side", true, true],
    [768, 1024, "single", false, false],
  ] as const) {
    await page.setViewportSize({ width, height });
    await expect(stage).toHaveAttribute("data-layout", layout);
    if (wide) await expect(ultra).toBeVisible();
    else await expect(ultra).toHaveCount(0);

    await openPane(events, eventsButton);
    await expect(events).toBeVisible();
    if (operations) await expect(goals).toBeVisible();
    else await expect(goals).toHaveCount(0);
    const history = events.getByRole("button", {
      name: "Filter event history, All events",
    });
    await history.scrollIntoViewIfNeeded();
    await expect(history).toBeInViewport();
    await eventsButton.click();
    await expect(events).toBeHidden();
    await expect(page.locator(".facilities:visible")).toBeVisible();
  }
});

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
    await openBuild(page);
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
        name: "Buying",
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
      await expect(page.locator("#buildNav")).toBeInViewport();
    }
  });
}
