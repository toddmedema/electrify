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

async function expectMobileFuelLegend(container: Locator, page: Page) {
  if (page.viewportSize()!.width > 600) return;
  const legend = container.getByRole("group", { name: "Show fuel prices" });
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

test("expanded chart axes and fuel controls fit with Larger text after resizing", async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("theme", "dark");
    localStorage.setItem("textSize", "larger");
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
  for (const name of ["Water", "Inflation & interest rate"]) {
    await insights
      .getByRole("button", { name: `Expand ${name} chart` })
      .click();
    const dialog = page.getByRole("dialog", { name, exact: true });
    await expectChartAxesInView(dialog);
    await dialog.getByRole("button", { name: `Close ${name} chart` }).click();
    await expect(dialog).toHaveCount(0);
  }
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
    for (const name of ["Water", "Inflation & interest rate", "Cash"]) {
      const button = insights.getByRole("button", {
        name: `Expand ${name} chart`,
      });
      await button.click();
      const focused = page.getByRole("dialog", { name, exact: true });
      await expect(focused.locator(".uplot")).toHaveCount(
        name === "Inflation & interest rate" ? 2 : 1,
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
