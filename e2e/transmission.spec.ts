import { expect, test } from "@playwright/test";

test("California players can build and understand an intertie", async ({
  page,
}, testInfo) => {
  test.skip(
    !new Set(["desktop-chromium", "mobile-320px"]).has(testInfo.project.name),
  );
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/?scenario=100");
  await page.getByRole("button", { name: "Start game" }).click();

  const facilities = page.locator(".facilities:visible");
  if (!(await facilities.isVisible())) {
    await page.getByRole("button", { name: "Facilities", exact: true }).click();
  }
  await facilities.getByRole("tab", { name: "Interties" }).click();
  await expect(
    facilities.getByRole("heading", { name: "Share power with nearby grids" }),
  ).toBeVisible();
  await expect(facilities.getByText("Pacific Northwest")).toBeVisible();
  await expect(facilities.getByLabel("Trading rule")).toContainText(
    "Buy for shortages, sell extra",
  );

  await facilities.getByRole("button", { name: /Build/ }).first().click();
  await expect(facilities.getByText("Your interties")).toBeVisible();
  await expect(facilities.getByText("Building")).toBeVisible();
  expect(
    await facilities.evaluate((element) =>
      Math.max(0, element.scrollWidth - element.clientWidth),
    ),
  ).toBeLessThanOrEqual(1);
});
