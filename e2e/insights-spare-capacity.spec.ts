import path from "path";
import { expect, test } from "./fixtures";
import { openPane } from "./layout";

for (const theme of ["light", "dark"] as const) {
  test(`Reliability shows monthly lowest spare capacity in ${theme}`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
    }, theme);
    await page.goto("/?scenario=103");
    await page.getByRole("button", { name: "Start game" }).click();
    const bar = page.locator("#appbar:visible");
    const date = bar.locator(".gameStatusValue.weak").first();
    const startingMonth = (await date.innerText()).split(",")[0];
    await bar.getByRole("button", { name: "fast speed", exact: true }).click();
    await expect(date).not.toContainText(startingMonth);
    await bar.getByRole("button", { name: "pause", exact: true }).click();
    const insights = page.locator(".insights:visible");
    await openPane(
      insights,
      page.getByRole("button", { name: "Insights", exact: true }),
    );
    await insights.getByRole("combobox", { name: "Insight preset" }).click();
    await page
      .getByRole("option", { name: "Reliability", exact: true })
      .click();
    const track = insights.getByRole("region", {
      name: "Lowest reserve evidence",
    });
    await expect(track).toBeVisible();
    await expect(track.locator("canvas")).toBeVisible();
    const chart = track.getByRole("img", {
      name: /Monthly lowest reserve/,
    });
    await chart.press("Home");
    await expect(track.getByRole("status")).toContainText(
      "Recorded monthly minimum",
    );
    await chart.press("End");
    await expect(track.getByRole("status")).toContainText(
      "Projected monthly minimum",
    );
    await expect(track.getByRole("status")).toContainText("Lowest reserve:");
    await chart.press("Escape");
    expect(
      await insights.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await insights.getByRole("button", { name: /^Layers \(/ }).click();
    await expect(
      insights.getByRole("checkbox", {
        name: "Lowest reserve",
        exact: true,
      }),
    ).toBeChecked();
    await insights
      .getByRole("button", { name: "Done choosing layers" })
      .click();
    const reviewDir = process.env.REVIEW_SCREENSHOT_DIR;
    if (
      reviewDir &&
      ((theme === "dark" && testInfo.project.name === "desktop-chromium") ||
        (theme === "light" && testInfo.project.name === "mobile-390px"))
    ) {
      await track.scrollIntoViewIfNeeded();
      await page.mouse.move(0, 0);
      await expect(page.getByRole("tooltip")).toHaveCount(0);
      await page.screenshot({
        path: path.join(
          reviewDir,
          `monthly-spare-${testInfo.project.name}-${theme}.png`,
        ),
      });
    }
  });
}
