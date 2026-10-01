import { expect, Page, test } from "@playwright/test";
import type { GameType } from "../src/Types";
import path from "path";
import { expectDialogToFit } from "./dialog-layout";

const setupHeading = (page: Page) =>
  page.getByRole("heading", {
    name: "Explore data center growth",
    exact: true,
  });
const startButton = (page: Page) =>
  page.getByRole("button", { name: "Start exploring", exact: true });

async function savedGame(page: Page): Promise<GameType | undefined> {
  return page.evaluate(() => {
    window.dispatchEvent(new Event("pagehide"));
    const saved = localStorage.getItem("savedGame");
    // Pair our synthetic save flush with a restore so later play controls still work.
    window.dispatchEvent(new Event("pageshow"));
    return saved ? JSON.parse(saved).game : undefined;
  });
}

async function ready(page: Page) {
  await expect(setupHeading(page)).toBeVisible();
  const location = page.getByRole("combobox", {
    name: "Select a city",
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
  await page.getByRole("link", { name: "Explore the impact" }).last().click();
  await expect(page).toHaveURL(/dataCenters=1/);
  await expect(startButton(page)).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Start year" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("combobox", { name: "Data centers open" }),
  ).toHaveCount(0);
  await ready(page);
  const search = await page
    .getByRole("combobox", { name: "Select a city", exact: true })
    .boundingBox();
  const nearest = await page
    .getByRole("button", { name: "Find nearest city", exact: true })
    .boundingBox();
  expect(nearest!.x).toBeGreaterThan(search!.x + search!.width);
  expect(
    Math.abs(nearest!.y + nearest!.height / 2 - search!.y - search!.height / 2),
  ).toBeLessThan(4);
  const startYear = await page
    .getByRole("combobox", { name: "Start year", exact: true })
    .boundingBox();
  const openYear = await page
    .getByRole("combobox", { name: "Data centers open", exact: true })
    .boundingBox();
  expect(openYear!.x).toBeGreaterThan(startYear!.x + startYear!.width);
  expect(Math.abs(openYear!.y - startYear!.y)).toBeLessThan(2);
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
    const start = (await startButton(page).boundingBox())!;
    const content = (await page
      .locator(".dataCenterSetupContent")
      .boundingBox())!;
    expect(
      Math.abs(start.x + start.width - (content.x + content.width - 16)),
    ).toBeLessThan(2);
    const gridSize = page.locator(".dataCenterSetupGridSize");
    await gridSize.locator("summary").click();
    const accounts = (await page
      .getByRole("spinbutton", { name: "Homes and businesses served" })
      .boundingBox())!;
    const source = (await gridSize.locator("p").last().boundingBox())!;
    expect(source.y).toBeGreaterThan(accounts.y + accounts.height);
    await expect(gridSize).not.toContainText("Your chosen size.");
    await expect(gridSize).not.toContainText("More than 380,000");
    await expect(gridSize).not.toContainText(
      "This published count stays fixed",
    );
    await gridSize.locator("summary").click();
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

test("the header explore button opens setup and first-time tips preserve the chosen grid", async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  const theme = testInfo.project.name === "mobile-390px" ? "dark" : "light";
  await page.addInitScript(
    (mode) => localStorage.setItem("theme", mode),
    theme,
  );
  await page.emulateMedia({ colorScheme: theme });
  await page.goto("/data-centers.html");
  await page
    .locator(".topnav")
    .getByRole("link", { name: "Explore the impact" })
    .click();
  await expect(page).toHaveURL(/dataCenters=1/);
  await ready(page);
  const reviewDir = process.env.REVIEW_SCREENSHOT_DIR;
  if (reviewDir && testInfo.project.name === "desktop-chromium") {
    await page.screenshot({
      path: path.join(reviewDir, "data-center-setup-desktop.png"),
      animations: "disabled",
    });
  }
  await startButton(page).click();
  const intro = page.getByRole("dialog", { name: "New to Electrify?" });
  await expect(intro).toBeVisible({ timeout: 30000 });
  await expectDialogToFit(intro);
  const before = (await savedGame(page))!;
  expect(before.inGame).toBe(true);
  expect(before.speed).toBe("PAUSED");
  for (const key of ["1", "3", "Space", "q", "w", "g", "?"])
    await page.keyboard.press(key);
  await expect(intro).toBeVisible();
  expect(await savedGame(page)).toEqual(before);
  await intro.getByRole("button", { name: "Show me the basics" }).click();
  await expect(page.getByText("1 of 4", { exact: true })).toBeVisible();
  if (reviewDir && testInfo.project.name === "desktop-chromium") {
    await page
      .getByRole("heading", { name: "You run an example grid" })
      .click();
    await page.screenshot({
      path: path.join(reviewDir, "data-center-guide-desktop.png"),
      animations: "disabled",
    });
  }
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByText("1 of 4", { exact: true })).toBeVisible();
  for (let step = 0; step < 3; step++)
    await page.getByRole("button", { name: "Next", exact: true }).click();
  const final = page.getByRole("dialog", {
    name: "Compare community tradeoffs",
  });
  await expectDialogToFit(final);
  await expect(
    final.getByText(/Close these tips, then choose 1×/),
  ).toBeVisible();
  if (reviewDir && testInfo.project.name === "mobile-390px") {
    await page
      .getByRole("heading", { name: "Compare community tradeoffs" })
      .click();
    await page.screenshot({
      path: path.join(reviewDir, "data-center-guide-mobile.png"),
      animations: "disabled",
    });
  }
  await final
    .getByRole("button", { name: "Ready to explore", exact: true })
    .click();
  await expect(final).toBeHidden();
  expect(await savedGame(page)).toEqual(before);
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("plays")!).plays.filter(
        (play: { scenarioId: number }) => play.scenarioId === 0,
      ),
    ),
  ).toEqual([expect.objectContaining({ timesPlayed: 1 })]);
  await page
    .locator("#appbar:visible")
    .getByRole("button", { name: "slow speed", exact: true })
    .first()
    .click();
  await expect
    .poll(async () => (await savedGame(page))?.date.minute)
    .toBeGreaterThan(before.date.minute);
  await page.reload();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator("#appbar:visible").first()).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "New to Electrify?" }),
  ).toHaveCount(0);
});

test("ignoring first-time tips records Mission 1 and prevents another offer", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.goto("/?dataCenters=1");
  await ready(page);
  await startButton(page).click();
  const guide = page.getByRole("dialog", { name: "New to Electrify?" });
  await expect(guide).toBeVisible({ timeout: 30000 });
  await page.keyboard.press("Escape");
  await expect(guide).toBeHidden();
  expect((await savedGame(page))?.speed).toBe("PAUSED");
  await page.goto("/?dataCenters=1");
  await ready(page);
  await startButton(page).click();
  const guard = page.getByRole("dialog", { name: "Start a new game?" });
  await expect(guard).toBeVisible();
  await guard.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(setupHeading(page)).toBeVisible();
  await startButton(page).click();
  await guard
    .getByRole("button", { name: "Start new game", exact: true })
    .click();
  await expect(page.locator("#appbar:visible").first()).toBeVisible({
    timeout: 30000,
  });
  await expect(guide).toHaveCount(0);
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
    page.getByRole("combobox", { name: "Select a city" }),
  ).toHaveValue(/Pittsburgh/);
  await expect(page.getByText(/Closest available city:/)).toHaveCount(0);
  await ready(page);
  await page.screenshot({
    path: testInfo.outputPath("nearest-location-success.png"),
    fullPage: true,
  });
  await page
    .locator(
      ".dataCenterSetupSummary .dataCenterSetupAssumptions:not(.dataCenterSetupGridSize) summary",
    )
    .click();
  await page
    .locator(
      ".dataCenterSetupSummary .dataCenterSetupAssumptions:not(.dataCenterSetupGridSize)",
    )
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
  const city = page.getByRole("combobox", { name: "Select a city" });
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
    name: "Select a city",
    exact: true,
  });
  await location.fill("Pittsburgh");
  await page.getByRole("option", { name: /Pittsburgh/ }).click();
  await ready(page);
  await page
    .getByRole("combobox", { name: "Start year", exact: true })
    .selectOption("2030");
  await expect(startButton(page)).toBeEnabled({ timeout: 60000 });
  await page
    .getByRole("combobox", { name: "Data centers open", exact: true })
    .selectOption("2035");
  const power = page.getByRole("slider", { name: "Power needed", exact: true });
  await expect(power).toHaveAttribute("aria-valuetext", "100MW");
  await power.press("End");
  await expect(power).toHaveAttribute("aria-valuetext", "10GW");
  await power.press("Home");
  await expect(power).toHaveAttribute("aria-valuetext", "0MW");
  await power.press("ArrowRight");
  await expect(power).toHaveAttribute("aria-valuetext", "10MW");
  for (let tick = 9; tick < 20; tick += 1) await power.press("ArrowRight");
  await expect(power).toHaveAttribute("aria-valuetext", "300MW");
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
        peakW: 300000000,
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
    .getByRole("slider", { name: "Power needed", exact: true })
    .press("Home");
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
