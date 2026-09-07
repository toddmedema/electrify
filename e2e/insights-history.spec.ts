import path from "path";
import { expect, test } from "@playwright/test";

test("public insights retain the benchmark and an absolute customer objective", async ({
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
  if (!(await page.locator(".insights").isVisible())) {
    await page.getByRole("button", { name: "Insights", exact: true }).click();
  }
  await expect(page.locator(".insightsLevers")).toContainText(
    "market benchmark",
  );
  await expect(page.locator(".insightsLevers")).toContainText("+1.5%");
  await page
    .locator("#appbar:visible")
    .getByRole("button", { name: "fast speed" })
    .first()
    .click();
  await expect(
    page.getByText(/Past charts show monthly averages/),
  ).toBeVisible();
  await page
    .locator("#appbar:visible")
    .getByRole("button", { name: "pause", exact: true })
    .first()
    .click();
  expect(
    await page
      .locator(".insightsLevers")
      .evaluate((el) => el.scrollWidth - el.clientWidth),
  ).toBeLessThanOrEqual(1);
  if (testInfo.project.name === "mobile-390px") {
    const metrics = await page.locator(".insightsRateMetric").all();
    const boxes = await Promise.all(
      metrics.map((metric) => metric.boundingBox()),
    );
    expect(new Set(boxes.map((box) => box!.y)).size).toBe(1);
    await expect(page.locator(".insightsRateMetricGrowth")).toContainText(
      "Customer growth / yr",
    );
  }
  const reviewDir = process.env.REVIEW_SCREENSHOT_DIR;
  if (reviewDir) {
    await page.screenshot({
      path: path.join(
        reviewDir,
        `public-insights-${testInfo.project.name}.png`,
      ),
      fullPage: true,
    });
  }
  await page
    .locator("#appbar:visible")
    .getByRole("button", { name: "menu", exact: true })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Scenario details" }).click();
  await expect(page.getByRole("dialog")).toContainText("14,850 customers");
  await expect(page.getByRole("dialog")).toContainText("16,500 at the start");
  if (reviewDir && testInfo.project.name === "desktop-chromium") {
    await page.getByRole("menu").waitFor({ state: "hidden" });
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(reviewDir, "customer-objective.png"),
      fullPage: true,
    });
  }
});
