import { reviewScreenshot } from "./review-screenshot";
import path from "path";
import { expect, test } from "./fixtures";
import { openPane, openBuild } from "./layout";
import { editSavedGame, readSavedGame } from "./save-fixture";

for (const theme of ["light", "dark"]) {
  test(`day and night follow the plot's time axis in ${theme}`, async ({
    page,
  }, info) => {
    if (info.project.name === "desktop-chromium")
      await page.setViewportSize({ width: 1500, height: 800 });
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
    const ribbon = chart.locator(".dayNightRibbon");
    await expect(ribbon).toBeVisible();
    await expect(ribbon).toHaveAttribute("aria-hidden", "true");
    await expect(ribbon).toHaveCSS("background-image", /linear-gradient/);
    await expect(chart.getByLabel("Current weather")).toHaveCount(0);
    await expect(ribbon.locator('[data-phase="day"] svg')).toHaveCount(1);
    await expect(ribbon.locator('[data-phase="night"] svg')).toHaveCount(2);
    await expect(chart.getByRole("button")).toHaveCount(0);
    await expect(chart.getByRole("img")).toHaveAccessibleName(
      /Day\/night ribbon: Night .*Daylight/,
    );

    const aligned = async () => {
      const plot = (await chart.locator(".u-over").boundingBox())!;
      const band = (await ribbon.boundingBox())!;
      const bounds = (await chart.boundingBox())!;
      expect(Math.abs(band.x - plot.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(band.width - plot.width)).toBeLessThanOrEqual(1);
      expect(band.y).toBeGreaterThan(plot.y + plot.height + 12);
      expect(band.y + band.height).toBeLessThanOrEqual(
        bounds.y + bounds.height,
      );
      const segments = await ribbon.locator("[data-phase]").all();
      const first = (await segments[0].boundingBox())!;
      const last = (await segments[segments.length - 1].boundingBox())!;
      expect(Math.abs(first.x - band.x)).toBeLessThanOrEqual(1);
      expect(
        Math.abs(last.x + last.width - band.x - band.width),
      ).toBeLessThanOrEqual(1);
    };
    await expect(aligned).toPass();
    const image = chart.getByRole("img");
    await image.focus();
    await image.press("Home");
    await expect(chart.locator(".chartTooltip")).toContainText("Total supply:");
    await expect(chart.locator(".chartTooltip")).toContainText("Weather:");
    await expect(chart.locator(".chartTooltip")).not.toContainText(
      /sunrise|solar noon|sunset/i,
    );
    await image.press("Escape");
    await page.mouse.move(0, 0);
    // Clear the keyboard focus ring for the review image.
    await page.getByRole("heading", { level: 6 }).first().click();
    await page.evaluate(() => document.fonts.ready);
    if (process.env.REVIEW_SCREENSHOT_DIR) {
      await page.screenshot({
        path: path.join(
          process.env.REVIEW_SCREENSHOT_DIR,
          `day-night-${info.project.name}-${theme}.png`,
        ),
        animations: "disabled",
      });
    }
    if (info.project.name === "desktop-chromium") {
      for (const width of [1299, 1330, 1500]) {
        await page.setViewportSize({ width, height: 800 });
        await openPane(
          pane,
          page.getByRole("button", { name: "Facilities", exact: true }),
        );
        await expect(aligned).toPass();
      }
      await openBuild(page);
      await page.locator("#insightsNav").click();
      await expect(page.locator(".gameToolPanel:visible")).toHaveCount(2);
      await expect(aligned).toPass();
    }
  });
}

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
    await openBuild(page);
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
    await expect(chart.getByText("Variable (solar, wind)", { exact: true })).toBeVisible();
    await expect(
      chart.getByText("Dispatchable (coal, gas…)", { exact: true }),
    ).toBeVisible();
    await expect(chart.locator(".chartLegendItem")).toHaveCount(5);
    await expect(chart.locator(".chartLegendItem").first()).toHaveText(
      "Demand",
    );
    await expect(chart.locator(".chartLegendSwatch-hatch")).toHaveCount(1);
    await expect(
      chart.locator(".chartLegend circle, .chartLegend rect"),
    ).toHaveCount(0);
    await expect(chart.locator(".chartPointDetails")).toHaveCount(0);
    await image.focus();
    const selectPoint = async (index: number) => {
      await image.press("Home");
      for (let i = 0; i < index; i++) await image.press("ArrowRight");
    };
    await selectPoint(charging);
    const details = chart.locator(".chartTooltip");
    await expect(details).toContainText("Storage charging:");
    await expect(details).toContainText("Demand:");
    const time = details.locator(":scope > div").first();
    const firstTime = await time.textContent();
    await image.press("ArrowRight");
    await expect(time).not.toHaveText(firstTime!);
    await selectPoint(exporting);
    await expect(details).toContainText("Interties:");
    await selectPoint(discharging);
    await expect(details).toContainText("Storage:");
    await image.press("End");
    await image.press("Escape");
    await expect(details).toBeHidden();
    const plot = chart.locator(".u-over");
    const bounds = (await plot.boundingBox())!;
    if (info.project.use.hasTouch) {
      await plot.tap({ position: { x: bounds.width * 0.8, y: 8 } });
    } else {
      await plot.click({ position: { x: bounds.width * 0.8, y: 8 } });
    }
    await expect(chart.locator(".chartPointDetails")).toHaveCount(0);
    await image.focus();
    await image.press("Home");
    // Touch compatibility events may leave the plot after keyboard selection. Exercise the
    // real uPlot handler in that order, rather than depending on the browser to race this run.
    await plot.dispatchEvent("mouseleave");
    await expect(
      details,
      "pointer leave must preserve keyboard selection",
    ).toBeVisible();
    const selectedTime = await time.textContent();
    await expect(chart.getByRole("status")).toContainText(selectedTime!);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await expect(details).toContainText("Total supply:");
    await expect(details).toContainText("Total load:");
    const totals = details.locator("strong");
    await expect(totals).toHaveCount(2);
    expect(
      await details.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    await reviewScreenshot(details, {
      path: info.outputPath(`storage-details-${theme}.png`),
    });
    await reviewScreenshot(chart, {
      path: info.outputPath(`keyboard-selection-${theme}.png`),
    });
    // An intentional pointer move takes over from keyboard selection. Screenshots may
    // scroll the plot on phones, so let the locator resolve its current viewport position.
    await plot.hover({ position: { x: bounds.width * 0.6, y: 8 } });
    await expect(chart.getByRole("status")).toBeEmpty();
    await expect(time).not.toHaveText(selectedTime!);
    await image.press("Home");
    await expect(details).toBeVisible();
    await image.press("Escape");
    await expect(details).toBeHidden();
    await expect(chart.getByRole("status")).toBeEmpty();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    // Blur also releases keyboard ownership, so the next hover can inspect another point.
    await image.press("Home");
    await expect(details).toBeVisible();
    await speed
      .getByRole("button", { name: "normal speed", exact: true })
      .first()
      .focus();
    await expect(details).toBeHidden();
    await expect(chart.getByRole("status")).toBeEmpty();
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
      await expect(tooltip).not.toContainText(/sunrise|solar noon|sunset/i);
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
    // A pointer that outruns the tooltip and lands on it still moves the cursor, so the tooltip
    // follows instead of freezing under it.
    {
      await page.mouse.move(
        hoverBounds.x + hoverBounds.width * 0.25,
        hoverBounds.y + 4,
      );
      const tooltip = chart.locator(".chartTooltip");
      const time = tooltip.locator(":scope > div").first();
      const before = await time.textContent();
      const tip = (await tooltip.boundingBox())!;
      // One jump, so the only move event lands on the tooltip rather than the plot.
      await page.mouse.move(tip.x + tip.width / 2, tip.y + tip.height / 2);
      await expect(time).not.toHaveText(before!);
    }
    if (
      process.env.REVIEW_SCREENSHOT_DIR &&
      theme === "light" &&
      info.project.name === "desktop-chromium"
    ) {
      await page.screenshot({
        path: path.join(
          process.env.REVIEW_SCREENSHOT_DIR,
          "chart-hover-desktop.png",
        ),
        animations: "disabled",
      });
    }
    await page.mouse.move(0, 0);
    await expect(details).toBeHidden();
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator(".MuiSnackbar-root")).toHaveCount(0);
    await reviewScreenshot(chart, {
      path: info.outputPath(`storage-${theme}.png`),
    });
    if (process.env.REVIEW_SCREENSHOT_DIR) {
      await chart.screenshot({
        path: path.join(
          process.env.REVIEW_SCREENSHOT_DIR,
          `pr-storage-${info.project.name}-${theme}.png`,
        ),
        animations: "disabled",
      });
      await pane.screenshot({
        path: path.join(
          process.env.REVIEW_SCREENSHOT_DIR,
          `pr-facilities-${info.project.name}-${theme}.png`,
        ),
        animations: "disabled",
      });
      if (info.project.name === "mobile-360px") {
        const vision = await page.context().newCDPSession(page);
        for (const type of [
          "achromatopsia",
          "deuteranopia",
          "protanopia",
        ] as const) {
          await vision.send("Emulation.setEmulatedVisionDeficiency", { type });
          await chart.screenshot({
            path: path.join(
              process.env.REVIEW_SCREENSHOT_DIR,
              `review-${type}-${theme}.png`,
            ),
          });
        }
        await vision.send("Emulation.setEmulatedVisionDeficiency", {
          type: "none",
        });
        await vision.detach();
      }
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
    await expect(chart.getByText("Variable (solar, wind)", { exact: true })).toBeVisible();
    await expect(
      chart.getByText("Dispatchable (coal, gas…)", { exact: true }),
    ).toBeVisible();
    await expect(chart.getByText("Sun", { exact: true })).toHaveCount(0);
    await expect(chart.getByText("Wind", { exact: true })).toHaveCount(0);
    // Fuels with output that day stay in the summary; wind can be calm all day.
    await expect(chart.getByRole("img")).toHaveAccessibleName(
      /Sun: latest .*Natural Gas: latest/,
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
    await reviewScreenshot(chart, {
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
  await openBuild(page);
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
  const speed = page.locator("#appbar:visible");
  // Freeze fixture setup, then explicitly advance the real reducer for a shortage sample.
  await speed
    .getByRole("button", { name: "pause", exact: true })
    .first()
    .click();
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
  await speed
    .getByRole("button", { name: "normal speed", exact: true })
    .first()
    .click();
  await expect(chart.getByRole("img")).toHaveAccessibleName(
    /blackout periods? shaded/,
  );
  await speed
    .getByRole("button", { name: "pause", exact: true })
    .first()
    .click();
  const game = (await readSavedGame(page))!;
  const shortage = game.timeline.findIndex(
    (tick) => tick.demandW > tick.supplyW && (tick.importedW || 0) > 0,
  );
  expect(shortage).toBeGreaterThanOrEqual(0);
  // The last sample maps to the plot's excluded right edge. Select the actual point through
  // the chart's keyboard controls rather than depending on a pixel hit at that boundary.
  const plot = chart.getByRole("img");
  await plot.focus();
  await plot.press("Home");
  for (let index = 0; index < shortage; index++) await plot.press("ArrowRight");
  await expect(chart.locator(".chartTooltip")).toContainText("Interties:");
  await expect(chart.locator(".chartTooltip")).toContainText("Blackout:");
  await plot.press("Escape");
  await page.mouse.move(0, 0);
  await expect(page.locator(".MuiSnackbar-root")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByText("Starting your mission…")).toHaveCount(0);
  await expect(page.locator('[class*="-exit-active"]')).toHaveCount(0);
  await reviewScreenshot(chart, {
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
  await expect.poll(async () => !!(await readSavedGame(page))).toBe(true);
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
  const details = chart.locator(".chartTooltip");
  for (const direction of [
    "Storage:",
    "Storage charging:",
    "Interties:",
    "Interties:",
  ]) {
    await expect(details).toContainText(direction);
  }
  await expect(details).toContainText("Blackout: 150MW unmet");
  await chart.getByRole("img").press("Escape");
  await page.evaluate(() => document.fonts.ready);
  await reviewScreenshot(chart, {
    path: info.outputPath("concurrent-flow-fixture.png"),
  });
});
