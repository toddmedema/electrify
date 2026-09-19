import { expect, Page, test } from "@playwright/test";
import { openPane } from "./layout";

async function startLesson(page: Page, name: string) {
  await page.addInitScript((lesson) => {
    localStorage.clear();
    localStorage.setItem(
      "plays",
      JSON.stringify({
        plays: [0, 1, 2, 4, 3, 5]
          .slice(
            0,
            [
              "Electricity",
              "Generators",
              "Storage",
              "Finances",
              "Pricing",
              "Forecasting",
            ].indexOf(lesson),
          )
          .map((scenarioId) => ({
            scenarioId,
            timesPlayed: 1,
            date: "2026-09-18",
          })),
      }),
    );
  }, name);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Start playing", exact: true })
    .click();
  await page
    .getByRole("button", { name: `Start ${name}`, exact: true })
    .click();
  await expect(page.locator(".tutorialHud")).toBeVisible();
}

async function next(page: Page) {
  await page
    .locator(".tutorialHud")
    .getByRole("button", { name: "Next", exact: true })
    .click();
}

async function expectTargetVisible(page: Page, selector: string) {
  await expect
    .poll(async () =>
      page
        .locator(selector)
        .first()
        .evaluate((element) => {
          const box = element.getBoundingClientRect();
          const hudBottom = document
            .querySelector(".tutorialHud")!
            .getBoundingClientRect().bottom;
          const footer = document.querySelector("#navfooter");
          const bottom =
            footer && footer.getBoundingClientRect().height
              ? footer.getBoundingClientRect().top
              : innerHeight;
          return (
            box.top >= hudBottom && box.bottom <= bottom + 1 && box.height > 0
          );
        }),
    )
    .toBe(true);
  await expect(
    page.locator(".tutorialTargetRing:visible").first(),
  ).toBeVisible();
}

test("Pricing reveals customers once and keeps the chosen rate when 1x starts its challenge", async ({
  page,
}) => {
  await startLesson(page, "Pricing");
  const opened = await openPane(
    page.locator(".insights"),
    page.locator("#insightsNav"),
  );
  if (!opened) await next(page);
  const rate = page.locator("#rateSlider input");
  await rate.focus();
  await rate.press("ArrowLeft");
  await expectTargetVisible(page, "#chartInsightsCustomers");
  const originalViewport = page.viewportSize()!;
  const selectedRate = await rate.inputValue();
  for (const width of [390, 768, 884, 1280]) {
    await page.setViewportSize({ width, height: 1024 });
    await expectTargetVisible(page, "#chartInsightsCustomers");
    await expect(page.locator("#rateSlider input")).toHaveValue(selectedRate);
    await expect(page.locator(".tutorialHud")).toContainText(
      "Find customer growth",
    );
  }
  await page.setViewportSize(originalViewport);
  await expectTargetVisible(page, "#chartInsightsCustomers");
  // A resize re-reveals the target once, 450ms after it settles. Let that land first.
  await page.waitForTimeout(600);
  // Revealing a target must not continuously pull the player away from other information.
  await page.locator("#rateSlider").scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await expect(page.locator("#rateSlider")).toBeInViewport();
  await next(page);
  const chosenRate = await rate.inputValue();
  await page.getByRole("button", { name: "slow speed", exact: true }).click();
  await expect(page.locator(".tutorialHud")).toContainText("Grow customers 5%");
  await expect(rate).toHaveValue(chosenRate);
  await expect(
    page.getByRole("button", { name: "slow speed", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("Storage names its fresh challenge, keeps practice until approval, and leaves HUD actions reachable", async ({
  page,
}) => {
  await startLesson(page, "Storage");
  await page.locator(".button-buildFacility").click();
  await page.getByRole("tab", { name: "Storage", exact: true }).click();
  await page
    .getByRole("button", { name: /Review purchase of/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Take loan", exact: true }).click();
  await expect(page.locator(".facilityRowHeader")).toHaveCount(3);
  await next(page);
  await expect(page.locator(".tutorialHud")).toContainText(
    "Check generation comes before storage",
  );
  await next(page);
  const start = page.getByRole("button", {
    name: "Start final challenge",
    exact: true,
  });
  await expect(start).toBeVisible();
  await page.getByRole("button", { name: "slow speed", exact: true }).click();
  await expect(start).toBeVisible();
  await expect(page.locator(".facilityRowHeader")).toHaveCount(3);
  for (const control of [
    start,
    page
      .locator(".tutorialHud")
      .getByRole("button", { name: "Exit", exact: true }),
  ]) {
    const box = await control.boundingBox();
    const hud = await page.locator(".tutorialHud").boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(hud!.y);
    expect(box!.y + box!.height).toBeLessThanOrEqual(hud!.y + hud!.height);
  }
  await start.click();
  await expect(page.locator(".tutorialHud")).toContainText(
    "Supply the evening peak",
  );
  await expect(page.locator(".facilityRowHeader")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "pause", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("Forecasting reveals later charts and waits for explicit fresh-challenge approval while running", async ({
  page,
}) => {
  await startLesson(page, "Forecasting");
  await page.getByRole("button", { name: "Inspect Coal", exact: true }).click();
  await page.getByRole("button", { name: "Pause Coal", exact: true }).click();
  await expectTargetVisible(page, "#chartForecastSupplyDemand");
  await next(page);
  await expect(
    page.getByRole("button", { name: "slow speed", exact: true }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "slow speed", exact: true }).click();
  await expect(page.locator(".tutorialHud")).toContainText(
    "Read the blackout event",
  );
  await next(page);
  await expect(
    page.getByRole("button", { name: "Resume Coal", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Resume Coal", exact: true }).click();
  await expectTargetVisible(page, "#chartForecastFuelPrices");
  await next(page);
  await expectTargetVisible(page, "#chartForecastWeather");
  await next(page);
  const start = page.getByRole("button", {
    name: "Start final challenge",
    exact: true,
  });
  await expect(start).toBeVisible();
  await page.getByRole("button", { name: "slow speed", exact: true }).click();
  await expect(start).toBeVisible();
  await expect(page.locator(".tutorialHud")).toContainText(
    "Start again before the blackout",
  );
  await start.click();
  await expect(page.locator(".tutorialHud")).toContainText(
    "Finish new generation",
  );
  // The restart's card transition briefly mounts the outgoing layout beside the new one.
  const pause = page.getByRole("button", { name: "pause", exact: true });
  await expect(pause).toHaveCount(1);
  await expect(pause).toHaveAttribute("aria-pressed", "true");
});
