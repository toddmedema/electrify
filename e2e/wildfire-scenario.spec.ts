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
    page.getByText(/They cut sales and generator output/),
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
  // The status bar's event chip names it too; check the ongoing card itself
  const ongoing = page.locator(".ongoingEvents:visible");
  await expect(
    ongoing.getByText("Wildfire emergency", { exact: true }),
  ).toBeVisible();
  await expect(
    ongoing.getByText("Through Feb 2025", { exact: true }),
  ).toBeVisible();
  await expect(ongoing).toContainText("Repairs cost $0.7M/month");
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
  const limitedPlant = page
    .locator(".facilityDisclosure")
    .filter({ has: page.getByLabel(/^Temporarily limited to/) })
    .first();
  await limitedPlant.click();
  const maximum = page
    .getByRole("region", { name: "Operation" })
    .locator(".facilityStat")
    .filter({ has: page.getByText("Current maximum output", { exact: true }) });
  await maximum.scrollIntoViewIfNeeded();
  await expect(maximum.locator(".facilityStatNote")).toHaveText(
    /^<?\d+% of nameplate$/,
  );
  const noteHeight = await maximum
    .locator(".facilityStatNote")
    .evaluate((el) => ({
      height: el.getBoundingClientRect().height,
      lineHeight: parseFloat(getComputedStyle(el).lineHeight),
    }));
  expect(noteHeight.height).toBeLessThanOrEqual(noteHeight.lineHeight + 1);

  if (
    reviewDir &&
    ["desktop-chromium", "mobile-390px"].includes(testInfo.project.name)
  ) {
    await page.mouse.move(0, 0);
    await page.screenshot({
      path: path.join(
        reviewDir,
        `wildfire-capacity-${testInfo.project.name}.png`,
      ),
      fullPage: true,
    });
  }
});
