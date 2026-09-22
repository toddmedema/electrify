import path from "path";
import { expect, test } from "@playwright/test";
import { openPane } from "./layout";

for (const theme of ["light", "dark"]) {
  test(`forecast charts and public rate feedback remain usable in ${theme}`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript((mode) => {
      if (!localStorage.getItem("savedGame")) localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
      localStorage.setItem(
        "insightsLayers",
        JSON.stringify(["cash", "profit", "supplyDemand"]),
      );
    }, theme);
    await page.goto("/?scenario=106");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const insights = page.locator(".insights:visible");
    await openPane(
      insights,
      page.getByRole("button", { name: "Insights", exact: true }),
    );
    const slider = insights.getByRole("slider", {
      name: "The rate you charge for electricity generation",
    });
    await slider.focus();
    await slider.press("End");
    await expect(insights.locator(".insightsRateScore").last()).toHaveClass(
      /bad/,
    );
    await expect(slider).toHaveAttribute("aria-valuetext", /rate score [−-]/);
    await slider.press("Home");
    await expect(insights.locator(".insightsRateScore").last()).toHaveClass(
      /good/,
    );
    await expect(slider).toHaveAttribute("aria-valuetext", /rate score \+/);
    // Persist a negative cash fixture so both the clipped chart and its textual alternative
    // can be inspected without relying on a particular scenario's path to insolvency.
    await page.evaluate(() => {
      window.dispatchEvent(new Event("pagehide"));
      const save = JSON.parse(localStorage.getItem("savedGame")!);
      for (const tick of save.game.timeline) tick.cash = -1_000_000;
      localStorage.setItem("savedGame", JSON.stringify(save));
    });
    await page.reload();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await openPane(
      insights,
      page.getByRole("button", { name: "Insights", exact: true }),
    );
    const cash = insights.locator('[data-layer="cash"]');
    await cash.scrollIntoViewIfNeeded();
    await expect(cash.getByRole("img")).toHaveAttribute(
      "aria-label",
      /Forecast Cash.*[−-]/,
    );
    const plot = cash.locator(".u-over");
    const box = await plot.boundingBox();
    expect(box!.width).toBeGreaterThan(100);
    if (info.project.use.hasTouch) {
      await plot.tap({ position: { x: box!.width / 2, y: box!.height / 2 } });
    }
    // Mouse inspection also exercises the desktop tooltip, on every viewport.
    await plot.hover({ position: { x: box!.width / 2, y: box!.height / 2 } });
    await expect(cash.locator(".chartTooltip")).toContainText("Cash negative");
    for (const selector of [
      ".insightsLevers",
      '[data-layer="cash"]',
      '[data-layer="profit"]',
    ]) {
      expect(
        await insights
          .locator(selector)
          .evaluate((el) => el.scrollWidth - el.clientWidth),
      ).toBeLessThanOrEqual(1);
    }
    if (process.env.REVIEW_SCREENSHOT_DIR) {
      await insights.locator(".insightsLevers").scrollIntoViewIfNeeded();
      await page.mouse.move(0, 0);
      await page.screenshot({
        path: path.join(
          process.env.REVIEW_SCREENSHOT_DIR,
          `projection-${info.project.name}-${theme}.png`,
        ),
      });
    }
    expect(errors).toEqual([]);
  });
}
