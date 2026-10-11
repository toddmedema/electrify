import path from "path";
import { expect, test } from "./fixtures";
import { openPane } from "./layout";
import { editSavedGame, readSavedGame } from "./save-fixture";

for (const theme of ["light", "dark"]) {
  test(`storage and complete demand remain compact and inspectable in ${theme}`, async ({
    page,
  }, info) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=108");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const pane = page.locator(".facilities:visible");
    const navigation = page.getByRole("button", {
      name: "Facilities",
      exact: true,
    });
    await openPane(pane, navigation);
    await pane.getByRole("button", { name: "Build", exact: true }).click();
    await page.getByRole("tab", { name: "Interties", exact: true }).click();
    await page
      .getByRole("button", {
        name: "Review purchase of Portugal intertie",
        exact: true,
      })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Pay cash", exact: true })
      .click();
    // Complete the purchased connection, then let the real reducer dispatch every flow.
    await editSavedGame(page, (save) => {
      save.game.transmission!.lines[0].yearsToBuildLeft = 0;
    });
    await page.reload();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await openPane(pane, navigation);
    await pane
      .getByRole("button", { name: "Inspect Natural Gas CC", exact: true })
      .click();
    await pane
      .getByRole("button", { name: "Pause Natural Gas CC", exact: true })
      .click();
    await pane
      .getByRole("button", { name: "Inspect Natural Gas CC", exact: true })
      .click();
    const speed = page.locator("#appbar:visible");
    await speed
      .getByRole("button", { name: "normal speed", exact: true })
      .first()
      .click();
    await expect
      .poll(async () => (await readSavedGame(page))?.date.minute || 0, {
        timeout: 30000,
      })
      .toBeGreaterThanOrEqual(720);
    await speed
      .getByRole("button", { name: "pause", exact: true })
      .first()
      .click();
    const game = (await readSavedGame(page))!;
    const charging = game.timeline.findIndex(
      (tick) => (tick.storageChargeW || 0) > 0,
    );
    const discharging = game.timeline.findIndex(
      (tick) => (tick.storageDischargeW || 0) > 0,
    );
    const exporting = game.timeline.findIndex(
      (tick) => (tick.exportedW || 0) > 0,
    );
    expect(charging).toBeGreaterThanOrEqual(0);
    expect(discharging).toBeGreaterThanOrEqual(0);
    expect(exporting).toBeGreaterThanOrEqual(0);
    const chart = pane.locator("#chartSupplyDemand");
    const image = chart.getByRole("img");
    await expect(chart.getByText("Storage", { exact: true })).toBeVisible();
    await expect(chart.getByText("Interties", { exact: true })).toBeVisible();
    await expect(
      chart.getByText("Weather-driven", { exact: true }),
    ).toBeVisible();
    await expect(chart.getByText("On-demand", { exact: true })).toBeVisible();
    await expect(chart.locator(".chartLegendItem")).toHaveCount(5);
    await expect(chart.locator(".chartLegendItem").first()).toHaveText(
      "Demand",
    );
    await expect(chart.locator(".chartLegendSwatch-hatch")).toHaveCount(1);
    await expect(chart.locator(".chartPointDetails")).toHaveCount(0);
    await image.focus();
    const selectPoint = async (index: number) => {
      await image.press("Home");
      for (let i = 0; i < index; i++) await image.press("ArrowRight");
    };
    await selectPoint(charging);
    const details = chart.locator(".chartPointDetails");
    await expect(details).toContainText("Storage charging:");
    await expect(details).toContainText("Demand:");
    const firstTime = await details.locator("strong").textContent();
    await image.press("ArrowRight");
    await expect(details.locator("strong")).not.toHaveText(firstTime!);
    await selectPoint(exporting);
    await expect(details).toContainText("Interties exporting:");
    await selectPoint(discharging);
    await expect(details).toContainText("Storage discharging:");
    await image.press("End");
    await image.press("Escape");
    await expect(details).toHaveCount(0);
    const plot = chart.locator(".u-over");
    const bounds = (await plot.boundingBox())!;
    if (info.project.use.hasTouch) {
      await plot.tap({ position: { x: bounds.width * 0.8, y: 8 } });
    } else {
      await plot.click({ position: { x: bounds.width * 0.8, y: 8 } });
    }
    await expect(details).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await expect(details).toContainText("Total supply:");
    await expect(details).toContainText("Total load:");
    const totals = details.locator(".chartPointDetailsTotal");
    await expect(totals).toHaveCount(2);
    for (const total of await totals.all()) {
      const totalBounds = (await total.boundingBox())!;
      expect(totalBounds.y + totalBounds.height).toBeLessThanOrEqual(
        page.viewportSize()!.height - 44,
      );
    }
    expect(
      await details.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    await details.screenshot({
      path: info.outputPath(`storage-details-${theme}.png`),
    });
    await chart.getByRole("button", { name: "Close chart details" }).click();
    await expect(details).toHaveCount(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    // Hover details stay within the plot, including at opposite corners on narrow screens.
    await chart.scrollIntoViewIfNeeded();
    const hoverBounds = (await plot.boundingBox())!;
    let previousHoverTime: string | null = null;
    for (const [x, y] of [
      [1, 1],
      [hoverBounds.width - 1, hoverBounds.height - 1],
    ]) {
      await page.mouse.move(hoverBounds.x + x, hoverBounds.y + y);
      const tooltip = chart.locator(".chartTooltip");
      await expect(tooltip).toBeVisible();
      const hoverTime = tooltip.locator(":scope > div").first();
      if (previousHoverTime)
        await expect(hoverTime).not.toHaveText(previousHoverTime);
      previousHoverTime = await hoverTime.textContent();
      const tip = (await tooltip.boundingBox())!;
      expect(tip.x).toBeGreaterThanOrEqual(hoverBounds.x - 1);
      expect(tip.y).toBeGreaterThanOrEqual(hoverBounds.y - 1);
      expect(tip.x + tip.width).toBeLessThanOrEqual(
        hoverBounds.x + hoverBounds.width + 1,
      );
      expect(tip.y + tip.height).toBeLessThanOrEqual(
        hoverBounds.y + hoverBounds.height + 1,
      );
    }
    await page.mouse.move(0, 0);
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator(".MuiSnackbar-root")).toHaveCount(0);
    await chart.screenshot({ path: info.outputPath(`storage-${theme}.png`) });
    if (process.env.REVIEW_SCREENSHOT_DIR) {
      await chart.screenshot({
        path: path.join(
          process.env.REVIEW_SCREENSHOT_DIR,
          `pr-storage-${info.project.name}-${theme}.png`,
        ),
        animations: "disabled",
      });
    }
  });

  test(`daily fuel production is readable in ${theme}`, async ({
    page,
  }, info) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=108");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const pane = page.locator(".facilities:visible");
    await openPane(
      pane,
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    const chart = pane.locator("#chartSupplyDemand");
    await expect(chart.locator("canvas")).toBeVisible();
    await expect(
      chart.getByText("Production by fuel", { exact: true }),
    ).toHaveCount(0);
    await expect(
      chart.getByText("Weather-driven", { exact: true }),
    ).toBeVisible();
    await expect(chart.getByText("On-demand", { exact: true })).toBeVisible();
    await expect(chart.getByText("Sun", { exact: true })).toHaveCount(0);
    await expect(chart.getByText("Wind", { exact: true })).toHaveCount(0);
    await expect(chart.getByRole("img")).toHaveAccessibleName(
      /Sun: latest .*Wind: latest/,
    );
    await expect(chart).not.toContainText("Bands: fuel output");
    await expect(chart).not.toContainText("Solid: recorded");
    await expect(chart.locator(".chartLegend")).not.toContainText(
      "Supply to customers",
    );
    await expect(chart.locator(".chartLegend")).not.toContainText("Blackout");
    expect(
      await pane.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    const legendBounds = await chart.locator(".chartLegend").boundingBox();
    for (const item of await chart.locator(".chartLegendItem").all()) {
      const bounds = (await item.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(legendBounds!.x);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(
        legendBounds!.x + legendBounds!.width + 1,
      );
    }
    // The stack must retain its shape and accessible values as records replace forecasts.
    await page
      .locator("#appbar:visible")
      .getByRole("button", { name: "normal speed", exact: true })
      .first()
      .click();
    await expect
      .poll(async () => (await readSavedGame(page))?.date.minute || 0, {
        timeout: 30000,
      })
      .toBeGreaterThanOrEqual(720);
    await page
      .locator("#appbar:visible")
      .getByRole("button", { name: "pause", exact: true })
      .first()
      .click();
    await expect(chart.getByRole("img")).toHaveAccessibleName(
      /Total supply: latest .*Total load: latest/,
    );
    const plot = chart.locator(".u-over");
    const bounds = (await plot.boundingBox())!;
    await page.mouse.move(
      bounds.x + bounds.width * 0.55,
      bounds.y + bounds.height * 0.4,
    );
    await expect(chart.locator(".chartTooltip")).toContainText("Total supply:");
    await expect(chart.locator(".chartTooltip")).toContainText("Total load:");
    await page.mouse.move(0, 0);
    await chart.scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByText("Starting your mission…")).toHaveCount(0);
    await expect(page.locator('[class*="-exit-active"]')).toHaveCount(0);
    await chart.screenshot({
      path: info.outputPath(`production-${theme}.png`),
    });
    if (process.env.REVIEW_SCREENSHOT_DIR) {
      await page.screenshot({
        path: path.join(
          process.env.REVIEW_SCREENSHOT_DIR,
          `pr-production-${info.project.name}-${theme}.png`,
        ),
        animations: "disabled",
      });
    }
  });
}

test("blackout periods remain visible when imports supplement fuel production", async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("theme", "dark");
    localStorage.setItem("audioEnabled", "false");
  });
  await page.goto("/?scenario=108");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  const pane = page.locator(".facilities:visible");
  const navigation = page.getByRole("button", {
    name: "Facilities",
    exact: true,
  });
  await openPane(pane, navigation);
  await pane.getByRole("button", { name: "Build", exact: true }).click();
  await page.getByRole("tab", { name: "Interties", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Review purchase of Portugal intertie",
      exact: true,
    })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Pay cash", exact: true })
    .click();
  // Complete a real purchased line without waiting a game year for construction.
  await editSavedGame(page, (save) => {
    save.game.transmission!.lines[0].yearsToBuildLeft = 0;
  });
  await page.reload();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await openPane(pane, navigation);
  for (const name of ["Natural Gas CC", "Nuclear"]) {
    await pane
      .getByRole("button", { name: `Inspect ${name}`, exact: true })
      .click();
    await pane
      .getByRole("button", { name: `Pause ${name}`, exact: true })
      .click();
    await pane
      .getByRole("button", { name: `Inspect ${name}`, exact: true })
      .click();
  }
  const chart = pane.locator("#chartSupplyDemand");
  await expect(chart.locator("canvas")).toBeVisible();
  await expect(
    chart.getByText("Supply to customers", { exact: true }),
  ).toHaveCount(0);
  await expect(chart.getByText("Blackout", { exact: true })).toHaveCount(0);
  await expect(chart.getByRole("img")).toHaveAccessibleName(
    /blackout periods? shaded/,
  );
  const game = (await readSavedGame(page))!;
  const shortage = game.timeline.findIndex(
    (tick) => tick.demandW > tick.supplyW && (tick.importedW || 0) > 0,
  );
  expect(shortage).toBeGreaterThanOrEqual(0);
  const tick = game.timeline[shortage];
  const rangeMin = game.timeline[0].minute;
  const rangeMax = game.timeline[game.timeline.length - 1].minute;
  await chart.scrollIntoViewIfNeeded();
  const bounds = (await chart.locator(".u-over").boundingBox())!;
  await page.mouse.move(
    bounds.x +
      (bounds.width * (tick.minute - rangeMin)) / (rangeMax - rangeMin),
    bounds.y + 4,
  );
  await expect(chart.locator(".chartTooltip")).toContainText(
    "Interties importing:",
  );
  await expect(chart.locator(".chartTooltip")).toContainText("Blackout:");
  await page.mouse.move(0, 0);
  await expect(page.locator(".MuiSnackbar-root")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByText("Starting your mission…")).toHaveCount(0);
  await expect(page.locator('[class*="-exit-active"]')).toHaveCount(0);
  await chart.screenshot({
    path: info.outputPath("production-blackout-dark.png"),
  });
  if (process.env.REVIEW_SCREENSHOT_DIR) {
    await page.screenshot({
      path: path.join(
        process.env.REVIEW_SCREENSHOT_DIR,
        `pr-production-blackout-${info.project.name}-dark.png`,
      ),
      animations: "disabled",
    });
  }
});

test("a full fuel mix and concurrent flows retain readable source keys on narrow screens", async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("theme", "dark");
    localStorage.setItem("audioEnabled", "false");
  });
  await page.goto("/?scenario=108");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await editSavedGame(page, (save) => {
    save.game.timeline.forEach((tick) => {
      tick.supplyByFuel = {
        Sun: 100e6,
        Wind: 100e6,
        Uranium: 100e6,
        Hydro: 100e6,
        "Natural Gas": 100e6,
        Coal: 100e6,
        Biomass: 100e6,
        Oil: 100e6,
        Geothermal: 100e6,
        "Offshore Wind": 100e6,
        "Airborne Wind": 100e6,
      };
      tick.storageDischargeW = 100e6;
      tick.importedW = 100e6;
      tick.storageChargeW = 180e6;
      tick.exportedW = 20e6;
      tick.demandW = 1250e6;
      tick.supplyW = 1100e6;
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
  await expect(chart.locator(".chartLegendItem")).toHaveCount(5);
  const legendBounds = (await chart.locator(".chartLegend").boundingBox())!;
  for (const item of await chart.locator(".chartLegendItem").all()) {
    const bounds = (await item.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(legendBounds.x);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(
      legendBounds.x + legendBounds.width + 1,
    );
  }
  await chart.getByRole("img").focus();
  await chart.getByRole("img").press("Home");
  const details = chart.locator(".chartPointDetails");
  for (const direction of [
    "Storage discharging:",
    "Storage charging:",
    "Interties importing:",
    "Interties exporting:",
  ]) {
    await expect(details).toContainText(direction);
  }
  await expect(details).toContainText("Blackout: 150MW unmet");
  await chart.getByRole("img").press("Escape");
  await page.evaluate(() => document.fonts.ready);
  await chart.screenshot({
    path: info.outputPath("concurrent-flow-fixture.png"),
  });
  if (process.env.REVIEW_SCREENSHOT_DIR) {
    await chart.screenshot({
      path: path.join(
        process.env.REVIEW_SCREENSHOT_DIR,
        `review-fixture-concurrent-${info.project.name}.png`,
      ),
    });
  }
});
