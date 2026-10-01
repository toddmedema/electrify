import { expect, Page, test } from "@playwright/test";
import type { GameType } from "../src/Types";

const setupHeading = (page: Page) =>
  page.getByRole("heading", {
    name: "Explore data-center growth",
    exact: true,
  });
const startButton = (page: Page) =>
  page.getByRole("button", { name: "Start exploring", exact: true });

async function savedGame(page: Page): Promise<GameType | undefined> {
  return page.evaluate(() => {
    window.dispatchEvent(new Event("pagehide"));
    const saved = localStorage.getItem("savedGame");
    return saved ? JSON.parse(saved).game : undefined;
  });
}

async function ready(page: Page) {
  await expect(setupHeading(page)).toBeVisible();
  const location = page.getByRole("combobox", {
    name: "Search cities",
    exact: true,
  });
  if (!(await location.inputValue())) {
    await location.fill("San Francisco");
    await page.getByRole("option", { name: /San Francisco/ }).click();
  }
  await expect(startButton(page)).toBeEnabled({ timeout: 60000 });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("audioEnabled", "false");
  });
});

test("the landing page opens a prepared current-year grid and supports browser history", async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  await page.goto("/about.html");
  await page
    .getByRole("link", { name: "Explore data centers and your grid" })
    .click();
  await page.getByRole("link", { name: "Explore the impact" }).click();
  await expect(page).toHaveURL(/dataCenters=1/);
  await ready(page);
  await expect(
    page.getByRole("group", { name: "Playable locations map", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".dataCenterSetupContent")).toContainText(
    String(new Date().getFullYear()),
  );
  await expect(
    page.getByRole("combobox", { name: "Scenario events", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Seed", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await ready(page);
  await page.goBack();
  await expect(page).toHaveURL(/\/data-centers\.html$/);
  await page.goForward();
  await ready(page);

  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((mode) => localStorage.setItem("theme", mode), theme);
    await page.emulateMedia({ colorScheme: theme });
    await page.reload();
    await ready(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    expect(
      await page
        .locator(".dataCenterSetupContent")
        .evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    await setupHeading(page).click();
    await expect(startButton(page)).toBeInViewport({ ratio: 1 });
    await page.screenshot({
      path: testInfo.outputPath(`data-center-setup-${theme}.png`),
      fullPage: true,
    });
    await page
      .getByRole("heading", { name: "How much extra power?", exact: true })
      .evaluate((element) => element.scrollIntoView({ block: "start" }));
    await expect(startButton(page)).toBeInViewport({ ratio: 1 });
    await page.screenshot({
      path: testInfo.outputPath(`data-center-controls-${theme}.png`),
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(/\/data-centers\.html$/);
});

test("nearest location uses browser permission and keeps manual selection available when denied", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(120000);
  await context.setGeolocation({ latitude: 40.44, longitude: -79.99 });
  await context.grantPermissions(["geolocation"]);
  await page.goto("/?dataCenters=1");
  await ready(page);
  await page.getByRole("button", { name: "Find nearest city" }).click();
  await expect(
    page.getByRole("combobox", { name: "Search cities" }),
  ).toHaveValue(/Pittsburgh/);
  await expect(
    page.getByRole("status").filter({ hasText: "Closest available city:" }),
  ).toContainText("Pittsburgh");
  await ready(page);
  await page.screenshot({
    path: testInfo.outputPath("nearest-location-success.png"),
    fullPage: true,
  });
  await page
    .locator(".dataCenterSetupSummary .dataCenterSetupAssumptions summary")
    .click();
  await page
    .locator(".dataCenterSetupSummary .dataCenterSetupAssumptions")
    .evaluate((element) => element.scrollIntoView({ block: "start" }));
  await page.screenshot({
    path: testInfo.outputPath("data-center-assumptions.png"),
    fullPage: true,
  });

  await context.clearPermissions();
  await page.addInitScript(() => {
    Object.defineProperty(navigator.geolocation, "getCurrentPosition", {
      configurable: true,
      value: (_success: PositionCallback, failure: PositionErrorCallback) =>
        failure({
          code: 1,
          message: "Permission denied",
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
        }),
    });
  });
  await page.reload();
  await ready(page);
  await page.getByRole("button", { name: "Find nearest city" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Location permission" }),
  ).toContainText("Search for a city or use the map.");
  await page.screenshot({
    path: testInfo.outputPath("nearest-location-denied.png"),
    fullPage: true,
  });
  const city = page.getByRole("combobox", { name: "Search cities" });
  await city.fill("Pittsburgh");
  await page.getByRole("option", { name: /Pittsburgh/ }).click();
  await ready(page);
  await expect(city).toHaveValue(/Pittsburgh/);
});

test("location changes prepare a populated grid and launching keeps its data-center load", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.goto("/?dataCenters=1");
  await ready(page);
  const location = page.getByRole("combobox", {
    name: "Search cities",
    exact: true,
  });
  await location.fill("Pittsburgh");
  await page.getByRole("option", { name: /Pittsburgh/ }).click();
  await ready(page);
  await page
    .getByRole("spinbutton", { name: "Starting year", exact: true })
    .fill("2030");
  await expect(startButton(page)).toBeEnabled({ timeout: 60000 });
  await page
    .getByRole("spinbutton", { name: "Year data centers open", exact: true })
    .fill("2035");
  await page
    .getByRole("spinbutton", { name: "Power needed (MW)", exact: true })
    .fill("250");
  await startButton(page).click();
  await expect(page.locator("#appbar:visible").first()).toBeVisible({
    timeout: 30000,
  });
  await expect
    .poll(async () => (await savedGame(page))?.customScenario?.locationId)
    .toBe("PIT");
  const game = (await savedGame(page))!;
  expect(game.startingYear).toBe(2030);
  expect(game.customScenario?.startingCustomers).toBeGreaterThan(0);
  expect(game.customScenario?.facilities.length).toBeGreaterThan(1);
  expect(game.customScenario?.eventScenarioIds).toEqual([]);
  expect(game.customScenario?.loadAdditions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        demandType: "Data Centers",
        startsYear: 2035,
        peakW: 250000000,
      }),
    ]),
  );
  await expect(page).not.toHaveURL(/dataCenters/);
});

test("baseline comparison keeps the same starting assumptions and protects an existing save", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.goto("/?dataCenters=1");
  await ready(page);
  await startButton(page).click();
  await expect(page.locator("#appbar:visible").first()).toBeVisible({
    timeout: 30000,
  });
  await expect
    .poll(async () => (await savedGame(page))?.customScenario?.eventScenarioIds)
    .toEqual([]);
  const growth = (await savedGame(page))!;
  await page.goto("/?dataCenters=1");
  await ready(page);
  const originalSave = await page.evaluate(() =>
    localStorage.getItem("savedGame"),
  );
  await page
    .getByRole("spinbutton", { name: "Power needed (MW)", exact: true })
    .fill("0");
  await startButton(page).click();
  const guard = page.getByRole("dialog", { name: "Start a new game?" });
  await expect(guard).toBeVisible();
  await guard.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem("savedGame"))).toBe(
    originalSave,
  );
  await expect(setupHeading(page)).toBeVisible();
  await startButton(page).click();
  await guard
    .getByRole("button", { name: "Start new game", exact: true })
    .click();
  await expect(page.locator("#appbar:visible").first()).toBeVisible({
    timeout: 30000,
  });
  await expect
    .poll(async () => (await savedGame(page))?.customScenario?.eventScenarioIds)
    .toEqual([]);
  const baseline = (await savedGame(page))!;
  expect(baseline.seed).toBe(growth.seed);
  expect(baseline.startingYear).toBe(growth.startingYear);
  expect(baseline.customScenario?.facilities).toEqual(
    growth.customScenario?.facilities,
  );
  expect(baseline.customScenario?.startingCustomers).toBe(
    growth.customScenario?.startingCustomers,
  );
  expect(baseline.customScenario?.durationMonths).toBe(
    growth.customScenario?.durationMonths,
  );
});
