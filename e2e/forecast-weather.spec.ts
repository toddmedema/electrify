import path from "path";
import { getDateFromMinute } from "../src/helpers/DateTime";
import { expect, test } from "./fixtures";
import { openPane } from "./layout";
import { editSavedGame } from "./save-fixture";

test("Buffalo data-center forecasts retain summer and winter after an off-hour refresh", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const theme = info.project.use.hasTouch ? "dark" : "light";
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript((mode) => {
    localStorage.setItem("theme", mode);
    localStorage.setItem("audioEnabled", "false");
    localStorage.setItem("units", "metric");
    localStorage.setItem(
      "insightsLayers",
      JSON.stringify(["weather", "water"]),
    );
  }, theme);
  await page.goto("/?dataCenters=1");
  const city = page.getByRole("combobox", {
    name: "Select a city",
    exact: true,
  });
  await city.fill("Buffalo");
  await page.getByRole("option", { name: /Buffalo, NY/ }).click();
  await page
    .getByRole("combobox", { name: "Start year", exact: true })
    .selectOption("2026");
  const start = page.getByRole("button", {
    name: "Start exploring",
    exact: true,
  });
  await expect(start).toBeEnabled({ timeout: 60000 });
  await start.click();
  const tips = page.getByRole("dialog", { name: "New to Electrify?" });
  await expect(tips).toBeVisible({ timeout: 30000 });
  await page.keyboard.press("Escape");
  await expect(tips).toBeHidden();

  // A decision or save reload can rebuild the hourly projection on any live tick.
  // Keep the clock deterministic so it cannot accidentally land on the hour.
  await editSavedGame(page, ({ game }) => {
    expect(game.customScenario?.locationId).toBe("Buffalo");
    game.date = getDateFromMinute(15, game.startingYear);
    game.speed = "PAUSED";
  });
  await page.reload();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const insights = page.locator(".insights:visible");
  await openPane(
    insights,
    page.getByRole("button", { name: "Insights", exact: true }),
  );
  const temperature = insights.locator("#chartForecastWeather");
  await expect(temperature.locator("canvas")).toBeVisible();
  const range = (await temperature.getAttribute("aria-label"))!.match(
    /range (-?[\d.]+) to (-?[\d.]+)/,
  );
  expect(range).not.toBeNull();
  expect(Number(range![1])).toBeLessThan(-5);
  expect(Number(range![2])).toBeGreaterThan(20);

  await insights.getByRole("button", { name: "Fit full timeline" }).click();
  await temperature.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  if (process.env.REVIEW_SCREENSHOT_DIR) {
    await page.screenshot({
      path: path.join(
        process.env.REVIEW_SCREENSHOT_DIR,
        `buffalo-temperature-${info.project.name}-${theme}.png`,
      ),
      animations: "disabled",
    });
  }
});
