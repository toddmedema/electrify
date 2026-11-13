import path from "path";
import { expect, test, type Locator, type Page } from "./fixtures";
import { openPane } from "./layout";

async function expectChartAxesInView(dialog: Locator) {
  await expect
    .poll(() =>
      dialog.locator(".expandedChartContent").evaluate((content) => {
        const bounds = content.getBoundingClientRect();
        const plots = Array.from(content.querySelectorAll(".uplot"));
        return Math.max(
          content.scrollHeight - content.clientHeight,
          ...plots.flatMap((plot) => {
            const chart = plot.getBoundingClientRect();
            return [bounds.top - chart.top, chart.bottom - bounds.bottom];
          }),
        );
      }),
    )
    .toBeLessThanOrEqual(1);
  for (const plot of await dialog.locator(".uplot").all()) {
    await expect(plot).toBeInViewport({ ratio: 1 });
  }
}

async function expectMobileFuelLegend(
  container: Locator,
  page: Page,
  name = "Show fuel prices",
) {
  if (page.viewportSize()!.width > 600) return;
  const legend = container.getByRole("group", { name });
  await expect(legend.getByText("Show", { exact: true })).toBeHidden();
  await expect
    .poll(() =>
      legend.getByRole("button").evaluateAll((buttons) => {
        const rows = new Map<number, number>();
        for (const button of buttons) {
          const top = Math.round(button.getBoundingClientRect().top);
          rows.set(top, (rows.get(top) || 0) + 1);
        }
        return Array.from(rows.values());
      }),
    )
    .toEqual([3, 3]);
  for (const button of await legend.getByRole("button").all()) {
    const bounds = (await button.boundingBox())!;
    const minimumHeight = await page.evaluate(() =>
      matchMedia("(pointer: coarse)").matches ? 44 : 40,
    );
    expect(bounds.height).toBeGreaterThanOrEqual(minimumHeight);
    expect(
      await button.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
  }
}

/**
 * The supply stack's key is the fuel price chart's selectable one, so it is held to the same
 * touch targets and kept inside its pane; it also names demand without making it a choice.
 */
async function expectSelectableFuelKey(
  container: Locator,
  page: Page,
  name: string,
) {
  const key = container.getByRole("group", { name });
  await expect(key).toBeVisible();
  await expect(
    key.getByRole("button", { name: "All fuels", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(key.getByText("Demand", { exact: true })).toBeVisible();
  await expect(
    key.getByRole("button", { name: "Demand", exact: true }),
  ).toHaveCount(0);
  const minimumHeight = await page.evaluate(() =>
    matchMedia("(pointer: coarse)").matches ? 44 : 40,
  );
  for (const button of await key.getByRole("button").all()) {
    const bounds = (await button.boundingBox())!;
    expect(bounds.height).toBeGreaterThanOrEqual(minimumHeight);
    expect(
      await button.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
  }
  expect(
    await key.evaluate((element) => element.scrollWidth - element.clientWidth),
  ).toBeLessThanOrEqual(1);
}

async function expectLegendLayout(container: Locator) {
  const legends = container.locator(".chartLegend");
  expect(await legends.count()).toBeGreaterThan(0);
  for (const legend of await legends.all()) {
    const geometry = await legend.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        left: bounds.left,
        right: bounds.right,
        overflow: element.scrollWidth - element.clientWidth,
        items: Array.from(element.querySelectorAll(".chartLegendItem")).map(
          (item) => {
            const pair = item.getBoundingClientRect();
            const swatch = item
              .querySelector(".chartLegendSwatch")!
              .getBoundingClientRect();
            const label = item
              .querySelector(".chartLegendLabel")!
              .getBoundingClientRect();
            return {
              left: pair.left,
              right: pair.right,
              top: pair.top,
              bottom: pair.bottom,
              sampleWidth: swatch.width,
              sampleGap: label.left - swatch.right,
            };
          },
        ),
      };
    });
    expect(
      geometry.overflow,
      "legend stays inside its pane",
    ).toBeLessThanOrEqual(1);
    expect(
      geometry.items[0].left - geometry.left,
      "legend follows the heading's 16px content inset",
    ).toBeCloseTo(16, 0);
    for (const [index, item] of geometry.items.entries()) {
      expect(item.right).toBeLessThanOrEqual(geometry.right - 15);
      expect(
        item.sampleWidth,
        "series samples never shrink",
      ).toBeGreaterThanOrEqual(8);
      expect(item.sampleGap, "sample stays close to its own label").toBeCloseTo(
        8,
        0,
      );
      const previous = geometry.items[index - 1];
      if (!previous) continue;
      if (Math.abs(previous.top - item.top) <= 1) {
        expect(
          item.left - previous.right,
          "series are clearly separated",
        ).toBeGreaterThanOrEqual(16);
      } else {
        expect(
          item.top - previous.bottom,
          "wrapped rows retain breathing room",
        ).toBeGreaterThanOrEqual(7);
      }
    }
  }
}

for (const theme of ["light", "dark"] as const) {
  test(`chart legends align and wrap in ${theme} at 125% interface scale`, async ({
    page,
  }, info) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("interfaceScale", "1.25");
      localStorage.setItem(
        "insightsLayers",
        JSON.stringify([
          "supplyDemand",
          "demandByType",
          "supplyByFuel",
          "water",
        ]),
      );
    }, theme);
    await page.goto("/?scenario=108");
    await page.getByRole("button", { name: "Start game" }).click();
    const insights = page.locator(".insights:visible");
    await openPane(
      insights,
      page.getByRole("button", { name: "Insights", exact: true }),
    );
    await expect(insights.locator(".uplot").first()).toBeVisible();
    if (process.env.REVIEW_SCREENSHOT_DIR) {
      await page.mouse.move(0, 0);
      await insights.screenshot({
        path: path.join(
          process.env.REVIEW_SCREENSHOT_DIR,
          `legends-${info.project.name}-${theme}.png`,
        ),
        animations: "disabled",
      });
    }
    await expectLegendLayout(insights);
    for (const name of [
      "Supply & Demand",
      "Demand by use",
      "Supply by Fuel",
      "Water",
    ]) {
      await insights
        .getByRole("button", { name: `Expand ${name} chart`, exact: true })
        .click();
      const dialog = page.getByRole("dialog", { name, exact: true });
      if (name === "Supply by Fuel") {
        await expectSelectableFuelKey(dialog, page, "Show supply by fuel");
      } else {
        await expectLegendLayout(dialog);
      }
      await expectChartAxesInView(dialog);
      await dialog.getByRole("button", { name: `Close ${name} chart` }).click();
      await expect(dialog).toHaveCount(0);
    }
  });
}

test("expanded chart axes and fuel controls fit at 125% interface scale after resizing", async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("theme", "dark");
    localStorage.setItem("interfaceScale", "1.25");
    localStorage.setItem(
      "insightsLayers",
      JSON.stringify(["fuelPrices", "water", "inflationInterest"]),
    );
  });
  await page.goto("/?scenario=108");
  await page.getByRole("button", { name: "Start game" }).click();
  const insights = page.locator(".insights:visible");
  await openPane(
    insights,
    page.getByRole("button", { name: "Insights", exact: true }),
  );
  await insights
    .getByRole("button", { name: "Expand Fuel Prices chart" })
    .click();
  const fuel = page.getByRole("dialog", { name: "Fuel Prices", exact: true });
  await expectChartAxesInView(fuel);
  await page.setViewportSize({ width: 360, height: 640 });
  await expectChartAxesInView(fuel);
  await expectMobileFuelLegend(fuel, page);
  if (
    process.env.REVIEW_SCREENSHOT_DIR &&
    info.project.name === "mobile-360px"
  ) {
    await page.mouse.move(0, 0);
    await page.screenshot({
      path: path.join(
        process.env.REVIEW_SCREENSHOT_DIR,
        "fuel-larger-text-mobile-360px-dark.png",
      ),
      animations: "disabled",
    });
  }
  await fuel.getByRole("button", { name: "Close Fuel Prices chart" }).click();
  await expect(fuel).toHaveCount(0);
  for (const name of ["Water", "Inflation & Interest"]) {
    await insights
      .getByRole("button", { name: `Expand ${name} chart` })
      .click();
    const dialog = page.getByRole("dialog", { name, exact: true });
    await expectChartAxesInView(dialog);
    await dialog.getByRole("button", { name: `Close ${name} chart` }).click();
    await expect(dialog).toHaveCount(0);
  }
});

test("every chart header keeps its help button beside the expand control, even while layers are edited", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem(
      "insightsLayers",
      JSON.stringify([
        "supplyDemand",
        "spareCapacity",
        "fuelPrices",
        "water",
        "inflationInterest",
        "cash",
      ]),
    );
  });
  await page.goto("/?scenario=108");
  await page.getByRole("button", { name: "Start game" }).click();
  const insights = page.locator(".insights:visible");
  await openPane(
    insights,
    page.getByRole("button", { name: "Insights", exact: true }),
  );
  const tracks = insights.locator(".insightsTrack");
  await expect(tracks.first()).toBeVisible();
  const measure = () =>
    tracks.evaluateAll((elements) =>
      elements.map((track) => {
        const box = (selector: string) => {
          const element = track.querySelector(selector);
          if (!element) return null;
          const { left, right, top, bottom, width, height } =
            element.getBoundingClientRect();
          return { left, right, top, bottom, width, height };
        };
        const header = track.querySelector(".insightsTrackHeader")!;
        return {
          layer: track.getAttribute("data-layer"),
          title: box(".insightsTrackHeader .MuiTypography-h6"),
          expand: box(".insightsExpandChart"),
          help: box(".insightsTrackHeader .manual-link"),
          actions: box(".insightsTrackActions"),
          overflow: header.scrollWidth - header.clientWidth,
          helpCount: header.querySelectorAll(".manual-link").length,
        };
      }),
    );
  const minimum = await page.evaluate(() =>
    matchMedia("(pointer: coarse)").matches ? 44 : 40,
  );
  const expectHeaders = async (editing: boolean) => {
    const headers = await measure();
    expect(headers.length).toBeGreaterThanOrEqual(5);
    for (const {
      layer,
      title,
      expand,
      help,
      actions,
      overflow,
      helpCount,
    } of headers) {
      const where = `${layer}${editing ? " while editing" : ""}`;
      expect(helpCount, `${where} has exactly one help button`).toBe(1);
      expect(expand && help && title, `${where} header controls`).toBeTruthy();
      // The title itself opens help, with a separate adjacent expand control.
      expect(help!.right, `${where} title clears expand`).toBeLessThanOrEqual(
        expand!.left + 1,
      );
      expect(
        help!.left,
        `${where} help starts at title`,
      ).toBeGreaterThanOrEqual(title!.left - 1);
      expect(help!.width, `${where} target width`).toBeGreaterThanOrEqual(
        minimum,
      );
      expect(help!.height, `${where} target height`).toBeGreaterThanOrEqual(
        minimum,
      );
      expect(overflow, `${where} header overflow`).toBeLessThanOrEqual(1);
      if (editing) {
        expect(actions, `${where} actions`).toBeTruthy();
        // After the help button on its row, or on the row beneath when a narrow header needs it
        expect(
          actions!.left >= expand!.right - 1 ||
            actions!.top >= expand!.bottom - 1,
          `${where} actions follow`,
        ).toBe(true);
        expect(
          actions!.right,
          `${where} actions stay on the screen`,
        ).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
      } else {
        expect(actions).toBeNull();
      }
    }
  };
  await expectHeaders(false);
  await insights.getByRole("button", { name: /^Layers \(/ }).click();
  await expectHeaders(true);
  await insights.getByRole("button", { name: "Done choosing layers" }).click();

  // The expanded view carries the same button, and the entry opens over it
  await insights
    .getByRole("button", { name: "Expand Fuel Prices chart" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Fuel Prices", exact: true });
  const help = dialog.getByRole("button", { name: "What is Fuel Prices?" });
  await expect(help).toBeVisible();
  await help.click();
  const manual = page.getByRole("dialog", { name: "Manual help" });
  await expect(
    manual.getByRole("heading", { name: "Fuel Prices", exact: true }),
  ).toBeVisible();
  await manual.getByRole("button", { name: "close", exact: true }).click();
  await expect(manual).toBeHidden();
  await dialog.getByRole("button", { name: "Close Fuel Prices chart" }).click();
  await expect(dialog).toHaveCount(0);
});

for (const theme of ["light", "dark"] as const) {
  test(`chart inspection preserves fuel selection and zoom in ${theme}`, async ({
    page,
  }, info) => {
    const resizeErrors: string[] = [];
    page.on("pageerror", (error) => {
      if (/ResizeObserver loop/.test(error.message))
        resizeErrors.push(error.message);
    });
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem(
        "insightsLayers",
        JSON.stringify(["fuelPrices", "water", "inflationInterest", "cash"]),
      );
    }, theme);
    await page.goto("/?scenario=108");
    await page.getByRole("button", { name: "Start game" }).click();
    const insights = page.locator(".insights:visible");
    await openPane(
      insights,
      page.getByRole("button", { name: "Insights", exact: true }),
    );
    const expand = insights.getByRole("button", {
      name: "Expand Fuel Prices chart",
    });
    const compact = insights.locator("#chartForecastFuelPrices .uplot");
    await expect(compact).toBeVisible();
    const compactHeight = (await compact.boundingBox())!.height;
    const reviewDir = process.env.REVIEW_SCREENSHOT_DIR;
    const capture = async (name: string) => {
      if (!reviewDir) return;
      await page.mouse.move(0, 0);
      await expect(page.getByRole("tooltip")).toHaveCount(0);
      await page.locator(".expandedChartContent").evaluateAll((elements) =>
        elements.forEach((element) => {
          element.scrollTop = 0;
        }),
      );
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await page.screenshot({
        path: path.join(reviewDir, `${name}-${info.project.name}-${theme}.png`),
        animations: "disabled",
      });
    };
    await capture("fuel-compact");
    await insights.getByRole("button", { name: "Coal", exact: true }).click();
    await expand.click();
    const dialog = page.getByRole("dialog", {
      name: "Fuel Prices",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect
      .poll(async () => {
        const box = (await dialog.boundingBox())!;
        return {
          x: Math.round(box.x),
          y: Math.round(box.y),
          width: Math.round(box.width),
          height: Math.round(box.height),
        };
      })
      .toEqual({ x: 0, y: 0, ...page.viewportSize()! });
    const coal = dialog.getByRole("button", { name: "Coal", exact: true });
    await expect(coal).toHaveAttribute("aria-pressed", "true");
    const chart = dialog.getByRole("img", { name: /predicted fuel prices/ });
    await expect(chart).toHaveAccessibleName(/Coal/);
    await expect(chart).not.toHaveAccessibleName(
      /Biomass|Natural Gas|Oil|Uranium/,
    );
    const navigation = dialog.getByRole("region", {
      name: "Chart time navigation",
    });
    const date = (await navigation
      .getByLabel(/^Displayed date range:/)
      .boundingBox())!;
    for (const button of await navigation.getByRole("button").all()) {
      const box = (await button.boundingBox())!;
      expect(
        Math.abs(box.y + box.height / 2 - date.y - date.height / 2),
        "date range and navigation buttons share one row",
      ).toBeLessThanOrEqual(1);
      const size = (await navigation.boundingBox())!.width <= 700 ? 44 : 40;
      expect(box.width).toBe(size);
      expect(box.height).toBe(size);
    }
    await expect(dialog.locator(".uplot")).toBeVisible();
    await expectChartAxesInView(dialog);
    await expectMobileFuelLegend(dialog, page);
    expect(
      (await dialog.locator(".uplot").boundingBox())!.height,
    ).toBeGreaterThan(compactHeight);
    const span = async () =>
      Number(await chart.getAttribute("data-viewport-max")) -
      Number(await chart.getAttribute("data-viewport-min"));
    const initialSpan = await span();
    await dialog.getByRole("button", { name: "Zoom in", exact: true }).click();
    await expect.poll(span).toBeLessThan(initialSpan);
    const range = await dialog
      .getByLabel(/^Displayed date range:/)
      .textContent();
    await chart.locator(".u-over").hover();
    await expect(chart.locator(".chartTooltip")).toContainText("Coal:");
    await expect(chart.locator(".chartTooltip")).not.toContainText(
      /Biomass|Natural Gas|Oil|Uranium/,
    );
    await capture("fuel-coal-expanded");
    await dialog
      .getByRole("button", { name: "All fuels", exact: true })
      .click();
    await expect(chart).toHaveAccessibleName(
      /Biomass.*Coal.*Natural Gas.*Oil.*Uranium/,
    );
    await capture("fuel-all-expanded");
    for (const control of await dialog.getByRole("button").all()) {
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(
        page.viewportSize()!.width + 1,
      );
    }
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await dialog
      .getByRole("button", { name: "Close Fuel Prices chart" })
      .press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(expand).toBeFocused();
    await expect(insights.getByLabel(/^Displayed date range:/)).toHaveText(
      range!,
    );
    await expect(
      insights.getByRole("button", { name: "All fuels", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expectMobileFuelLegend(insights, page);
    for (const name of ["Water", "Inflation & Interest", "Cash"]) {
      const button = insights.getByRole("button", {
        name: `Expand ${name} chart`,
      });
      await button.click();
      const focused = page.getByRole("dialog", { name, exact: true });
      await expect(focused.locator(".uplot")).toHaveCount(
        name === "Inflation & Interest" ? 2 : 1,
      );
      await expect(focused.locator(".uplot").first()).toBeVisible();
      await expectChartAxesInView(focused);
      expect(
        await focused.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
      await capture(
        `expanded-${name === "Water" ? "water" : name === "Cash" ? "cash" : "rates"}`,
      );
      await focused
        .getByRole("button", { name: `Close ${name} chart` })
        .click();
      await expect(focused).toHaveCount(0);
    }
    expect(resizeErrors).toEqual([]);
  });
}
