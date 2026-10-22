import path from "path";
import { expect, Page, test } from "./fixtures";
import { openPane } from "./layout";

// Seed 1 resamples the observed 2020 LA record: two heavy-smoke days in August, then eleven in September.
const SEED = 1;
const REVIEW_PROJECTS = new Set([
  "desktop-chromium",
  "mobile-390px",
  "mobile-360px",
]);

async function startSeededLosAngelesGame(
  page: Page,
  theme?: "light" | "dark",
): Promise<void> {
  await page.addInitScript(
    ({ theme: mode }) => {
      window.localStorage.clear();
      if (mode) localStorage.setItem("theme", mode);
      // A prior play keeps the scenario list in its steady state for the assertions below.
      localStorage.setItem(
        "plays",
        JSON.stringify({
          plays: [
            { scenarioId: 0, timesPlayed: 1, date: new Date().toString() },
          ],
        }),
      );
    },
    { theme },
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Start playing", exact: true })
    .click();
  await page.getByRole("button", { name: "View Custom Game details" }).click();
  await expect(
    page.getByRole("heading", { name: "Custom setup" }),
  ).toBeVisible();

  // The default custom game is San Francisco; the hazard profile under test is Los Angeles.
  const search = page.getByRole("combobox", { name: "Search playable cities" });
  await search.click();
  await search.fill("Los Angeles");
  await page.getByRole("option", { name: "Los Angeles, CA" }).click();
  await expect(search).toHaveValue("Los Angeles, CA");

  // Pin the observed smoke year; the default start year (2020) stays as-is.
  await page.getByRole("textbox", { name: "Seed" }).fill(String(SEED));

  // The default custom fleet (one 500MW gas plant) cannot cover LA's summer peak, so the run
  // would spend its first months in blackout noise. Add a matching plant to keep the grid stable;
  // ignition timing is fleet-independent, so the pinned seed still holds.
  await page.getByRole("combobox", { name: "Facility type" }).click();
  await page.getByRole("option", { name: "Natural Gas Peaker" }).click();
  await page.getByRole("button", { name: "Add facility" }).click();
  const outlook = page.getByRole("region", { name: "Year 1 outlook" });
  await expect(outlook).toContainText("Demand covered", { timeout: 20_000 });

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator("#appbar:visible").first()).toBeVisible({
    timeout: 30_000,
  });
}

async function setFastSpeed(page: Page): Promise<void> {
  await page
    .locator("#appbar:visible")
    .getByRole("button", { name: "fast speed" })
    .first()
    .click();
}

async function openProgramsPane(page: Page): Promise<void> {
  await openPane(
    page.getByRole("region", { name: "Programs", exact: true }),
    page.getByRole("button", { name: "Programs", exact: true }),
  );
}

async function openEventsPane(page: Page): Promise<void> {
  await openPane(
    page.locator(".eventLog:visible"),
    page.getByRole("button", { name: "Events", exact: true }),
  );
}

/** The status rows whose height an active event must not change. */
async function statusBarHeights(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    ["#topbar", ".gameStatusBar"].map(
      (selector) =>
        document.querySelector(selector)!.getBoundingClientRect().height,
    ),
  );
}

async function captureReviewScreenshot(
  page: Page,
  testInfo: { project: { name: string }; outputPath: (name: string) => string },
  name: string,
): Promise<void> {
  const reviewDir = process.env.REVIEW_SCREENSHOT_DIR;
  if (reviewDir) {
    await page.screenshot({ path: path.join(reviewDir, name), fullPage: true });
  } else {
    await page.screenshot({ path: testInfo.outputPath(name) });
  }
}

for (const theme of ["light", "dark"] as const) {
  test(`recurring smoke: solar scope and expiry (${theme})`, async ({
    page,
  }, testInfo) => {
    test.skip(!REVIEW_PROJECTS.has(testInfo.project.name));
    test.setTimeout(180000);
    await startSeededLosAngelesGame(page, theme);
    await openProgramsPane(page);
    const programs = page.getByRole("region", {
      name: "Programs",
      exact: true,
    });
    await expect(
      programs.getByRole("button", { name: /^Wildfire preparedness/ }),
    ).toHaveCount(0);
    await programs.getByRole("button", { name: "Close Programs" }).click();
    const heights = await statusBarHeights(page);
    await openEventsPane(page);
    await setFastSpeed(page);
    const ongoing = page.locator(".ongoingEvents:visible");
    await expect(
      ongoing.getByText("Wildfire smoke", { exact: true }),
    ).toBeVisible({ timeout: 90000 });
    await page
      .locator("#appbar:visible")
      .getByRole("button", { name: "pause", exact: true })
      .click();
    await expect(ongoing).toContainText(
      /Solar receives about [\d.]+% less sunlight from 10am to 6pm this month/,
    );
    await expect(ongoing).not.toContainText("Natural Gas");
    await expect(ongoing).not.toContainText("disconnected");
    await expect(ongoing).not.toContainText("Restoration costs");
    await expect(ongoing).toContainText("Through Aug 2020");
    await expect(page.locator(".wildfireRiskNotice:visible")).toContainText(
      "Heavy wildfire smoke can reduce sunlight",
    );
    expect(await statusBarHeights(page)).toEqual(heights);
    const clippedStatus = await page
      .locator("#topbar:visible .gameStatus")
      .evaluate((status) => {
        const bounds = status.getBoundingClientRect();
        return [...status.querySelectorAll(".gameStatusValue")].some(
          (value) => value.getBoundingClientRect().right > bounds.right + 1,
        );
      });
    expect(clippedStatus).toBe(false);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await captureReviewScreenshot(
      page,
      testInfo,
      `wildfire-smoke-${theme}-${testInfo.project.name}.png`,
    );
    await setFastSpeed(page);
    await expect(
      ongoing.getByRole("button", { name: /Through Aug 2020/ }),
    ).toBeHidden({ timeout: 30000 });
    await expect(
      page
        .getByRole("region", { name: "Event history", exact: true })
        .getByText("Wildfire smoke", { exact: true })
        .first(),
    ).toBeVisible();
  });
}
