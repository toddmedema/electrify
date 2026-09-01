import { expect, test } from "@playwright/test";

test("custom setup and settings stay usable on a 320px phone", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-320px");
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.localStorage.setItem(
      "plays",
      JSON.stringify({
        plays: [{ scenarioId: 0, date: new Date().toString() }],
      }),
    );
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Start playing", exact: true })
    .click();
  await page.getByRole("button", { name: "View Custom Game details" }).click();

  await expect(
    page.getByRole("heading", { name: "Custom setup" }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Search playable cities" }),
  ).toBeVisible();
  const setupOverflow = await page
    .locator("#gameSetupTable")
    .locator("..")
    .evaluate((element) =>
      Math.max(0, element.scrollWidth - element.clientWidth),
    );
  expect(setupOverflow).toBeLessThanOrEqual(1);

  await page.goto("/");
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(
    page.getByRole("heading", { name: "Keyboard shortcuts" }),
  ).toBeVisible();
  const settingsOverflow = await page
    .locator(".scrollable")
    .evaluate((element) =>
      Math.max(0, element.scrollWidth - element.clientWidth),
    );
  expect(settingsOverflow).toBeLessThanOrEqual(1);
});

test("main-menu resources do not sit behind the footer at low height", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-320px");
  await page.setViewportSize({ width: 360, height: 320 });
  await page.goto("/");

  const resources = await page
    .getByRole("navigation", { name: "Game resources" })
    .boundingBox();
  const footer = await page.locator(".mainMenuFooter").boundingBox();
  expect(resources).not.toBeNull();
  expect(footer).not.toBeNull();
  const overlap = Math.max(
    0,
    Math.min(resources!.y + resources!.height, footer!.y + footer!.height) -
      Math.max(resources!.y, footer!.y),
  );
  expect(overlap).toBe(0);
  expect(
    await page
      .locator("#menuCard")
      .evaluate((element) => element.scrollHeight > element.clientHeight),
  ).toBe(true);
});
