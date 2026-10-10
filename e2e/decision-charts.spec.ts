import path from "path";
import { expect, test } from "./fixtures";
import { openPane } from "./layout";

test("operating overview keeps editing quiet and full-campaign peaks readable", async ({
  page,
}, testInfo) => {
  test.skip(
    !["desktop-chromium", "mobile-390px"].includes(testInfo.project.name),
  );
  await page.emulateMedia({
    colorScheme:
      testInfo.project.name === "desktop-chromium" ? "dark" : "light",
  });
  await page.addInitScript(() => localStorage.clear());
  await page.goto("/?scenario=107");
  await page.getByRole("button", { name: "Start game" }).click();
  const insights = page.locator(".insights:visible");
  await openPane(
    insights,
    page.getByRole("button", { name: "Insights", exact: true }),
  );
  await expect(insights.locator(".insightsTrack")).toHaveCount(3);
  await expect(
    insights.getByLabel("Displayed date range: Jan–Dec 2017"),
  ).toBeVisible();
  await expect(insights.getByLabel("Chart time key")).toContainText("Recorded");
  await expect(insights.getByLabel("Chart time key")).toContainText("Forecast");
  await expect(
    insights.getByRole("button", { name: "Remove Cash" }),
  ).toHaveCount(0);
  await expect(insights.locator('[data-layer="emissions"]')).toHaveCount(1);
  await expect(
    insights.getByRole("slider", {
      name: "The rate you charge for electricity generation",
    }),
  ).toBeVisible();
  expect(
    await insights.evaluate(
      (element) => element.scrollWidth - element.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByText("Starting your mission…")).toHaveCount(0);
  await expect(page.locator('[class*="-exit-active"]')).toHaveCount(0);
  if (process.env.REVIEW_SCREENSHOT_DIR) {
    await page.screenshot({
      path: path.join(
        process.env.REVIEW_SCREENSHOT_DIR,
        `pr-charts-overview-${testInfo.project.name}.png`,
      ),
    });
  }
  await insights.getByRole("button", { name: /Layers \(/ }).click();
  await expect(
    insights.getByRole("button", { name: "Move Cash up" }),
  ).toBeVisible();
  await insights.getByRole("button", { name: "Move Cash up" }).click();
  await expect(insights.locator(".insightsTrack").first()).toHaveAttribute(
    "data-layer",
    "cash",
  );
  await insights.getByRole("button", { name: "Done choosing layers" }).click();
  await expect(
    insights.getByRole("button", { name: "Move Cash up" }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("insightsLayers")!)[0],
    ),
  ).toBe("cash");
  // Keep screenshot comparisons in the authored Overview order after proving the edit persists.
  await insights.getByRole("button", { name: /Layers \(/ }).click();
  await insights.getByRole("button", { name: "Move Cash down" }).click();
  await insights.getByRole("button", { name: "Done choosing layers" }).click();
  await insights.getByRole("button", { name: "Fit full timeline" }).click();
  await expect(
    insights.getByRole("img", {
      name: /^Monthly ranges of estimated electricity supply and demand/,
    }),
  ).toBeVisible();
  await expect(insights.locator(".insightsChartExplanation")).toContainText(
    "lows and peaks",
  );
  await page.mouse.move(0, 0);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  if (
    process.env.REVIEW_SCREENSHOT_DIR &&
    testInfo.project.name === "desktop-chromium"
  ) {
    await page.screenshot({
      path: path.join(
        process.env.REVIEW_SCREENSHOT_DIR,
        "pr-charts-monthly-ranges-desktop.png",
      ),
    });
  }
  // Zooming back to one year restores the detailed forecast and leaves the same shared range.
  for (let zoom = 0; zoom < 4; zoom++) {
    await insights.getByRole("button", { name: "Zoom in" }).click();
  }
  await expect(
    insights.getByRole("img", {
      name: /^Chart of estimated electricity supply and demand/,
    }),
  ).toBeVisible();
  const ranges = await insights
    .locator(".accessibleChart [role=img]")
    .evaluateAll((elements) =>
      elements.map((element) => [
        element.getAttribute("data-viewport-min"),
        element.getAttribute("data-viewport-max"),
      ]),
    );
  expect(
    ranges.every(
      (range) => JSON.stringify(range) === JSON.stringify(ranges[0]),
    ),
  ).toBe(true);
});
