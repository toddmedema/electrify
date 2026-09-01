import { expect, test } from "@playwright/test";

async function openSettings(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
}

test("settings use a centered readable measure on desktop", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440px");
  await openSettings(page);

  const preferences = page.getByRole("region", { name: "Preferences" });
  await expect
    .poll(async () => {
      const bounds = await preferences.boundingBox();
      if (!bounds) return Number.POSITIVE_INFINITY;
      return Math.abs(bounds.x + bounds.width / 2 - 1440 / 2);
    })
    .toBeLessThanOrEqual(1);

  const bounds = await preferences.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.width).toBeLessThanOrEqual(760);
});

test("settings remain direct and overflow-free on a common phone", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-390px");
  await openSettings(page);

  await expect(page.getByRole("group", { name: "Appearance" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Units" })).toBeVisible();
  await page.getByRole("switch", { name: "Sound" }).click();
  await expect(
    page.getByRole("slider", { name: "Music volume" }),
  ).toBeVisible();

  const overflow = await page
    .locator(".scrollable")
    .evaluate((element) =>
      Math.max(0, element.scrollWidth - element.clientWidth),
    );
  expect(overflow).toBeLessThanOrEqual(1);
});
