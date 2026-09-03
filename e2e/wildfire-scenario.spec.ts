import path from "path";
import { expect, test } from "@playwright/test";

const REVIEW_PROJECTS = new Set(["desktop-chromium", "mobile-390px"]);

test("wildfire briefing and ongoing emergency stay usable", async ({
  page,
}, testInfo) => {
  test.skip(!REVIEW_PROJECTS.has(testInfo.project.name));
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/?scenario=111");

  await expect(
    page.getByRole("heading", { name: "Wildfire Emergency" }),
  ).toBeVisible();
  await expect(page.getByText("LOS ANGELES, CA")).toBeVisible();
  await expect(page.getByText(/Safety shutoffs will cut sales/)).toBeVisible();

  const reviewDir = process.env.REVIEW_SCREENSHOT_DIR;
  if (reviewDir && testInfo.project.name === "desktop-chromium") {
    // Let the incoming details card finish sliding over the main menu before capturing the frame.
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(reviewDir, "wildfire-briefing-desktop.png"),
    });
  }

  await page.getByRole("button", { name: "Start game" }).click();
  await expect(page.getByText("Natural Gas", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Events", exact: true }).click();
  await page
    .locator("#appbar:visible")
    .getByRole("button", { name: "fast speed" })
    .first()
    .click();

  await expect(
    page.getByRole("heading", { name: "Ongoing events" }),
  ).toBeVisible({ timeout: 25000 });
  await expect(page.getByText("Wildfire emergency")).toBeVisible();
  await expect(page.getByText("Through Feb 2025")).toBeVisible();
  await expect(page.getByText(/restoration costs \$1\.5M/)).toBeVisible();
  await expect(page.getByText("Red-flag warning")).toBeVisible();

  const horizontalOverflow = await page
    .locator(".eventLog:visible")
    .last()
    .evaluate((element) =>
      Math.max(0, element.scrollWidth - element.clientWidth),
    );
  expect(horizontalOverflow).toBeLessThanOrEqual(1);

  if (reviewDir) {
    await page.screenshot({
      path: path.join(reviewDir, `wildfire-event-${testInfo.project.name}.png`),
      fullPage: true,
    });
  }
});
