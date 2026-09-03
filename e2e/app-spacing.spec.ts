import { expect, test } from "@playwright/test";

const isPhoneProject = (projectName: string) =>
  projectName === "mobile-390px" || projectName === "mobile-320px";

async function expectNoHorizontalOverflow(
  locator: import("@playwright/test").Locator,
) {
  const overflow = await locator.evaluate((element) =>
    Math.max(0, element.scrollWidth - element.clientWidth),
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test("phone surfaces share stable gutters and compact chrome", async ({
  page,
}, testInfo) => {
  test.skip(!isPhoneProject(testInfo.project.name));

  await page.goto("/");
  await page.getByRole("button", { name: "How to play" }).click();
  await page.waitForTimeout(400);
  const manualEntries = page.locator(".manual-entry");
  const firstManualEntry = await manualEntries.nth(1).boundingBox();
  const secondManualEntry = await manualEntries.nth(2).boundingBox();
  expect(firstManualEntry).not.toBeNull();
  expect(secondManualEntry).not.toBeNull();
  expect(firstManualEntry!.x).toBeCloseTo(8, 0);
  expect(
    secondManualEntry!.y - (firstManualEntry!.y + firstManualEntry!.height),
  ).toBeCloseTo(8, 0);
  await expectNoHorizontalOverflow(page.locator("#manual"));

  await page.goto("/?scenario=103");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  await page.getByRole("button", { name: "Events", exact: true }).click();
  await page.waitForTimeout(400);
  const eventItems = page.locator(".upcomingEvents .eventLogItem");
  const firstEvent = await eventItems.nth(0).boundingBox();
  const secondEvent = await eventItems.nth(1).boundingBox();
  expect(firstEvent).not.toBeNull();
  expect(secondEvent).not.toBeNull();
  expect(firstEvent!.x).toBeCloseTo(8, 0);
  expect(secondEvent!.y - (firstEvent!.y + firstEvent!.height)).toBeCloseTo(
    8,
    0,
  );

  await page.getByRole("button", { name: "Facilities", exact: true }).click();
  await page.getByRole("button", { name: "Storage" }).click();
  await expect(
    page.getByRole("heading", { name: "Build Storage" }),
  ).toBeVisible();
  await page.waitForTimeout(400);
  await expectNoHorizontalOverflow(page.locator(".constructionHeader"));

  const closeButton = await page
    .getByRole("button", { name: "close" })
    .boundingBox();
  expect(closeButton).not.toBeNull();
  expect(closeButton!.x + closeButton!.width).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );

  const firstBuildCard = await page
    .locator(".cardList > .build-list-item")
    .first()
    .boundingBox();
  expect(firstBuildCard).not.toBeNull();
  expect(firstBuildCard!.x).toBeCloseTo(8, 0);
  expect(firstBuildCard!.width).toBeCloseTo(page.viewportSize()!.width - 16, 0);

  const buildAction = page
    .locator(".cardList > .build-list-item .MuiCardHeader-action")
    .first();
  const buyButton = await buildAction.getByRole("button").boundingBox();
  const buildTiming = await buildAction.locator("p").boundingBox();
  expect(buyButton).not.toBeNull();
  expect(buildTiming).not.toBeNull();
  expect(
    buildTiming!.x - (buyButton!.x + buyButton!.width),
  ).toBeGreaterThanOrEqual(7);
  await expectNoHorizontalOverflow(page.locator("#topbar"));
});
