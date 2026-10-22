import path from "path";
import { expect, test } from "./fixtures";
import { openPane } from "./layout";

test("wildfire briefing and ongoing emergency stay usable", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => window.localStorage.clear());
  await page.emulateMedia({
    colorScheme: testInfo.project.use.hasTouch ? "dark" : "light",
  });
  await page.goto("/?scenario=111");

  await expect(
    page.getByRole("heading", { name: "Wildfire Emergency" }),
  ).toBeVisible();
  await expect(page.getByText("LOS ANGELES, CA")).toBeVisible();
  await expect(
    page.getByText(
      /Fire damage and emergency isolation interrupt customer service/,
    ),
  ).toBeVisible();

  const reviewDir = process.env.REVIEW_SCREENSHOT_DIR;
  await page.getByRole("button", { name: "Start game" }).click();
  await expect(page.getByText("Natural Gas CC", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Events", exact: true }).click();
  await page
    .locator("#appbar:visible")
    .getByRole("button", { name: "fast speed" })
    .first()
    .click();

  await page
    .getByRole("button", { name: "Keep cash" })
    .click({ timeout: 75000 });
  await page
    .locator("#appbar:visible")
    .getByRole("button", { name: "fast speed" })
    .first()
    .click();

  await expect(
    page.getByRole("heading", { name: "Ongoing events" }),
  ).toBeVisible({ timeout: 25000 });
  await page
    .locator("#appbar:visible")
    .getByRole("button", { name: "pause", exact: true })
    .first()
    .click();
  // The status bar's event chip names it too; check the ongoing card itself
  const ongoing = page.locator(".ongoingEvents:visible");
  await expect(
    ongoing.getByText("Wildfire emergency", { exact: true }),
  ).toBeVisible();
  await expect(
    ongoing.getByText("Through Jan 2025", { exact: true }),
  ).toBeVisible();
  await expect(ongoing).toContainText(
    "Estimated January 14–28 interruptions equal 0.31% of monthly demand",
  );
  await expect(ongoing).toContainText("Response and repairs cost $0.26M/month");
  await expect(ongoing).not.toContainText("generators are limited");
  await expect(page.getByText("Red-flag warning")).toBeVisible();

  const horizontalOverflow = await page
    .locator(".eventLog:visible")
    .last()
    .evaluate((element) =>
      Math.max(0, element.scrollWidth - element.clientWidth),
    );
  expect(horizontalOverflow).toBeLessThanOrEqual(1);

  const eventsNav = page.getByRole("button", { name: "Events", exact: true });
  // Reading the event removes its unread dot, but its emergency stays visible.
  await eventsNav.click();
  await expect(
    page.getByRole("region", { name: "Events", exact: true }),
  ).toHaveCount(0);
  await openPane(page.locator(".eventLog"), eventsNav);
  await expect(eventsNav).toHaveAccessibleDescription("Ongoing emergency");
  await expect(eventsNav.locator(".gameDockEmergency")).toBeVisible();
  await openPane(
    page.locator(".facilities"),
    page.getByRole("button", { name: "Facilities", exact: true }),
  );
  await expect(eventsNav.locator(".gameDockEmergency")).toBeVisible();
  await openPane(page.locator(".eventLog"), eventsNav);

  if (
    reviewDir &&
    ["desktop-chromium", "mobile-390px"].includes(testInfo.project.name)
  ) {
    await page.mouse.move(0, 0);
    await page.screenshot({
      path: path.join(
        reviewDir,
        `wildfire-service-${testInfo.project.name}.png`,
      ),
      fullPage: true,
    });
  }
});
