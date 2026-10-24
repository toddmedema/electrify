import path from "node:path";
import { expect, test } from "./fixtures";
import { foregroundContrast } from "./contrast";
import { openPane } from "./layout";

for (const theme of ["light", "dark"] as const) {
  test(`bundled typography stays readable without a font service in ${theme}`, async ({
    page,
  }) => {
    const fontRequests: string[] = [];
    page.on("request", (request) => {
      if (request.resourceType() === "font") fontRequests.push(request.url());
    });
    await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) =>
      route.abort(),
    );
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=108");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    await expect(
      page.getByText("Starting your mission…", { exact: true }),
    ).toBeHidden();
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(() => document.fonts.check("600 15px Inter")),
    ).toBe(true);
    expect(
      fontRequests.some((url) =>
        url.endsWith("/fonts/inter/InterVariable.woff2"),
      ),
    ).toBe(true);
    const origin = new URL(page.url()).origin;
    expect(fontRequests.every((url) => new URL(url).origin === origin)).toBe(
      true,
    );

    const pane = page.locator(".facilities:visible");
    await openPane(
      pane,
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    // The dock's Build action is an icon on the dock surface: measure the icon against the
    // nearest painted background, to the 3:1 non-text contrast an icon-only control needs.
    const build = page.locator("#buildNav");
    const contrast = await foregroundContrast(build);
    expect(contrast).toBeGreaterThanOrEqual(3);
    await build.click();
    await page.locator(".button-buildGenerator").click();
    await expect(page.locator(".buildOption").first()).toBeVisible();
    for (const card of await page.locator(".buildOption").all()) {
      expect(
        await card.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
    }
    const metrics = page.locator(".buildOptionMetric").first();
    const type = await metrics.evaluate((element) => {
      const value = element.querySelector(".MuiTypography-body2")!;
      const label = element.querySelector(".MuiTypography-caption")!;
      return {
        value: parseFloat(getComputedStyle(value).fontSize),
        label: parseFloat(getComputedStyle(label).fontSize),
        numeric: getComputedStyle(value).fontVariantNumeric,
      };
    });
    expect(type.value).toBeGreaterThan(type.label);
    expect(type.value).toBeGreaterThanOrEqual(14);
    expect(type.numeric).toContain("tabular-nums");
  });

  test(`tutorial action label meets small-text contrast in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
      localStorage.setItem(
        "plays",
        JSON.stringify({
          plays: [{ scenarioId: 0, timesPlayed: 1, date: "2026-10-20" }],
        }),
      );
    }, theme);
    await page.goto("/");
    await page.getByRole("button", { name: "Play", exact: true }).click();
    const action = page.locator(".tutorialSpotlightAction");
    await expect(action).toBeVisible();
    expect(await foregroundContrast(action)).toBeGreaterThanOrEqual(4.5);
    const shots = process.env.REVIEW_SCREENSHOT_DIR;
    if (shots && theme === "light" && testInfo.project.name === "mobile-390px")
      await page.screenshot({
        path: path.join(shots, "tutorial-action-mobile-light.png"),
        animations: "disabled",
      });
  });

  test(`upcoming event numbers meet small-text contrast in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=106");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    await expect(page.locator(".facilities")).toBeVisible();
    await page.keyboard.press("0");
    const insights = page.getByRole("region", {
      name: "Insights",
      exact: true,
    });
    await openPane(
      insights,
      page.getByRole("button", { name: "Insights", exact: true }),
    );
    // The compact mission header can prioritize a cash warning over the upcoming event.
    // Open the same event rail directly and include the announced years in its range.
    await insights
      .getByRole("button", { name: "Fit full timeline", exact: true })
      .click();
    const numbers = page.locator(".insightEventNumber");
    await expect(numbers.first()).toBeVisible();
    for (const number of await numbers.all())
      expect(await foregroundContrast(number)).toBeGreaterThanOrEqual(4.5);
    const shots = process.env.REVIEW_SCREENSHOT_DIR;
    if (
      shots &&
      ((theme === "light" && testInfo.project.name === "desktop-chromium") ||
        (theme === "dark" && testInfo.project.name === "mobile-390px"))
    ) {
      if (!testInfo.project.use.hasTouch)
        await insights.locator(".insightEventChip").first().click();
      await page.screenshot({
        path: path.join(
          shots,
          `event-numbers-${testInfo.project.name}-${theme}.png`,
        ),
        animations: "disabled",
      });
    }
  });
}
