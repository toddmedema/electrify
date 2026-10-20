import path from "path";
import { expect, test } from "./fixtures";
import { openPane } from "./layout";

test("public pricing shows the rate score and an absolute customer objective", async ({
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
  ).not.toContainText("January");
  await page
    .locator("#appbar:visible")
    .getByRole("button", { name: "pause", exact: true })
    .first()
    .click();
  expect(
    await pricing.evaluate((el) => el.scrollWidth - el.clientWidth),
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
  ).toContainText("14,850 customers");
  if (reviewDir && testInfo.project.name === "desktop-chromium") {
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(reviewDir, "customer-objective.png"),
      fullPage: true,
    });
  }
});
