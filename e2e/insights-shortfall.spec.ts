import { expect, test, type Locator } from "./fixtures";
import { openPane } from "./layout";
import { reviewScreenshot } from "./review-screenshot";

async function shortfallCapPixels(chart: Locator): Promise<number> {
  return chart.evaluate((element) => {
    const canvas = element.querySelector("canvas")!;
    const plot = element.querySelector(".u-over")!.getBoundingClientRect();
    const bounds = canvas.getBoundingClientRect();
    const scale = canvas.width / bounds.width;
    // Sample inside the cap at the top of the plot, away from axes and series labels.
    const x = Math.ceil((plot.left - bounds.left) * scale);
    const y = Math.ceil((plot.top - bounds.top + 2) * scale);
    const width = Math.max(1, Math.floor(plot.width * scale) - 1);
    const pixels = canvas.getContext("2d")!.getImageData(x, y, width, 1).data;
    let red = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (
        pixels[index] > pixels[index + 1] * 1.5 &&
        pixels[index] > pixels[index + 2] * 1.5 &&
        pixels[index + 3] > 200
      ) {
        red++;
      }
    }
    return red;
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`monthly shortfalls use the chart's MW scale in ${theme}`, async ({
    page,
  }, info) => {
    test.skip(
      !["desktop-chromium", "mobile-390px", "mobile-360px"].includes(
        info.project.name,
      ),
    );
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
      localStorage.setItem("insightsLayers", JSON.stringify(["supplyDemand"]));
    }, theme);
    await page.goto("/?scenario=100");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const insights = page.locator(".insights:visible");
    await openPane(
      insights,
      page.getByRole("button", { name: "Insights", exact: true }),
    );
    const track = insights.getByRole("region", {
      name: "Supply & Demand evidence",
      exact: true,
    });
    const chart = track.locator("#chartForecastSupplyDemand");
    await expect(chart.locator("canvas")).toBeVisible();
    await expect(chart).toHaveAccessibleName(/largest peak shortfall is/);
    await expect(track.locator(".chartLegend")).toContainText("Unmet demand");
    await expect(track.locator(".chartLegend")).toContainText(
      "Red height shows peak shortfall on the same MW scale, capped at full height.",
    );
    await expect.poll(() => shortfallCapPixels(chart)).toBeGreaterThan(0);
    await chart.scrollIntoViewIfNeeded();
    const over = chart.locator(".u-over");
    // Find an actual marked month without assuming a seeded scenario's peak or plot width.
    const shortfallX = await over.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      for (let x = 1; x < bounds.width; x++) {
        element.dispatchEvent(
          new MouseEvent("mousemove", {
            bubbles: true,
            clientX: bounds.left + x,
            clientY: bounds.top + bounds.height * 0.9,
          }),
        );
        const highlight = element.querySelector<HTMLElement>(
          ".chartShortfallHighlight",
        );
        if (highlight && !highlight.hidden) return x;
      }
      return undefined;
    });
    expect(shortfallX).toBeDefined();
    const bounds = (await over.boundingBox())!;
    const highlight = chart.locator(".chartShortfallHighlight");
    let previousBounds: {
      x: number;
      y: number;
      width: number;
      height: number;
    } | null = null;
    for (const height of [0.05, 0.95]) {
      await page.mouse.move(
        bounds.x + shortfallX!,
        bounds.y + bounds.height * height,
      );
      await expect(highlight).toBeVisible();
      const highlighted = (await highlight.boundingBox())!;
      expect(highlighted.height).toBeLessThanOrEqual(bounds.height);
      if (previousBounds) expect(highlighted).toEqual(previousBounds);
      previousBounds = highlighted;
      await expect(chart.locator(".chartTooltip")).toContainText(
        "Average unmet demand:",
      );
      await expect(chart.locator(".chartTooltip")).toContainText(
        "Peak shortfall:",
      );
    }
    for (const container of [insights, track, track.locator(".chartLegend")]) {
      expect(
        await container.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(1);

    // Three review views across the requested matrix, without saving images to the repo.
    if (
      info.project.name === "desktop-chromium" ||
      (theme === "light" && info.project.name === "mobile-360px")
    ) {
      await track.scrollIntoViewIfNeeded();
      await page.mouse.move(0, 0);
      await page.evaluate(() => document.fonts.ready);
      await reviewScreenshot(track, {
        path: info.outputPath(`shortfall-${info.project.name}-${theme}.png`),
        animations: "disabled",
      });
    }
  });
}
