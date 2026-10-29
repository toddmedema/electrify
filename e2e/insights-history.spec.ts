import path from "path";
import { expect, test } from "./fixtures";
import { openPane } from "./layout";
import { reviewScreenshot } from "./review-screenshot";

test("public pricing shows the rate score and the customer retention objective", async ({
  page,
}, testInfo) => {
  test.skip(
    !["desktop-chromium", "mobile-390px"].includes(testInfo.project.name),
  );
  await page.emulateMedia({
    colorScheme:
      testInfo.project.name === "desktop-chromium" ? "dark" : "light",
  });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem(
      "insightsLayers",
      JSON.stringify(["demandByType", "customers", "supplyDemand"]),
    );
  });
  await page.goto("/?scenario=106");
  await page.getByRole("button", { name: "Start game" }).click();
  const programs = page.getByRole("region", { name: "Programs", exact: true });
  await openPane(
    programs,
    page.getByRole("button", { name: "Programs", exact: true }),
  );
  const pricing = programs.getByRole("region", { name: "Electricity pricing" });
  // A public utility's pricing feedback shows its rate score and target.
  await expect(pricing).toContainText(/rate score/i);
  await expect(pricing).not.toContainText(/market/i);
  await page
    .locator("#appbar:visible")
    .getByRole("button", { name: "fast speed" })
    .first()
    .click();
  // The first completed month records history
  await expect(
    page.locator(".gameStatusValue.weak:visible").first(),
  ).not.toContainText(/Jan 2020/);
  await page
    .locator("#appbar:visible")
    .getByRole("button", { name: "pause", exact: true })
    .first()
    .click();
  expect(
    await programs
      .locator(".customerProgramsBody")
      .evaluate((el) => el.scrollWidth - el.clientWidth),
  ).toBeLessThanOrEqual(1);
  if (testInfo.project.name === "mobile-390px") {
    const metrics = await pricing.locator(".insightsRateMetric:visible").all();
    const boxes = await Promise.all(
      metrics.map((metric) => metric.boundingBox()),
    );
    expect(new Set(boxes.map((box) => box!.y)).size).toBe(1);
    await expect(
      pricing.locator(".insightsRateMetric:visible").last(),
    ).toContainText("Points / yr");
  }
  const reviewDir = process.env.REVIEW_SCREENSHOT_DIR;
  if (reviewDir) {
    await page.screenshot({
      path: path.join(reviewDir, `public-pricing-${testInfo.project.name}.png`),
      fullPage: true,
    });
  }
  await page
    .locator("#navfooter:visible")
    .getByRole("button", { name: "Scenario", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("region", { name: "Scenario", exact: true }),
  ).toContainText("Retain ≥90% of starting customers");
  if (reviewDir && testInfo.project.name === "desktop-chromium") {
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(reviewDir, "customer-objective.png"),
      fullPage: true,
    });
  }
});

for (const theme of ["light", "dark"]) {
  test(`customer inspection preserves three significant digits in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
      localStorage.setItem("insightsLayers", JSON.stringify(["customers"]));
      const labels: string[] = [];
      (
        window as Window & { customerAxisLabels?: string[] }
      ).customerAxisLabels = labels;
      const draw = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (
        this: CanvasRenderingContext2D,
        text: string,
        x: number,
        y: number,
        maxWidth?: number,
      ) {
        if (this.canvas.closest("#chartInsightsCustomersPlot"))
          labels.push(text);
        if (maxWidth === undefined) draw.call(this, text, x, y);
        else draw.call(this, text, x, y, maxWidth);
      };
    }, theme);
    await page.goto("/?scenario=106");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    await page.locator("#insightsNav").click();
    const chart = page.locator("#chartInsightsCustomersPlot");
    await expect(chart).toBeVisible();
    await chart.locator(".u-over").hover({ position: { x: 1, y: 20 } });
    await expect(chart.locator(".chartTooltip")).toBeVisible();
    await expect(chart.locator(".chartTooltip")).toContainText("16.5K");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as Window & { customerAxisLabels?: string[] })
              .customerAxisLabels || [],
        ),
      )
      .toContain("0");
    const axisLabels = await page.evaluate(
      () =>
        (window as Window & { customerAxisLabels?: string[] })
          .customerAxisLabels || [],
    );
    expect(
      axisLabels.filter((label) =>
        /^[-−]0(?:[.,]0+)*(?:[A-Za-z%°]+)?$/.test(label),
      ),
    ).toEqual([]);
    await reviewScreenshot(page, {
      path: testInfo.outputPath(`customer-precision-${theme}.png`),
      animations: "disabled",
    });
  });
}
