import path from "node:path";
import { expect, test, type Locator } from "./fixtures";
import { openBuild, openPane } from "./layout";
import { chartScale } from "../src/components/base/UPlotHelpers";

const expectRightInsets = async (insights: Locator) => {
  // Water uses this space for its reservoir axis; every other plot ends on the title guide.
  const tracks = insights.locator('.insightsTrack:not([data-layer="water"])');
  await expect
    .poll(() =>
      tracks.evaluateAll((elements) =>
        Math.max(
          ...elements.flatMap((track) => {
            const bounds = track.getBoundingClientRect();
            const title = track.querySelector(".insightsTrackHeader h6")!;
            const inset = title.getBoundingClientRect().left - bounds.left;
            return Array.from(track.querySelectorAll(".u-over"), (plot) =>
              Math.abs(
                bounds.right - plot.getBoundingClientRect().right - inset,
              ),
            );
          }),
        ),
      ),
    )
    .toBeLessThanOrEqual(1);
};

for (const theme of ["light", "dark"] as const) {
  test.describe(theme, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((mode) => {
        localStorage.clear();
        localStorage.setItem("theme", mode);
        localStorage.setItem(
          "insightsLayers",
          JSON.stringify([
            "supplyByFuel",
            "supplyDemand",
            "fuelPrices",
            "cash",
            "demandByType",
            "weather",
            "water",
            "solarCapacityFactor",
          ]),
        );
      }, theme);
    });

    test(`build content swipes between tabs while capacity controls and scrolling stay usable in ${theme}`, async ({
      page,
    }, info) => {
      test.skip(!info.project.use.hasTouch);
      await page.goto("/?scenario=106");
      await page
        .getByRole("button", { name: "Start game", exact: true })
        .click();
      const build = await openBuild(page);
      const client = await page.context().newCDPSession(page);
      const swipe = async (target: Locator, dx: number, dy = 0) => {
        await target.scrollIntoViewIfNeeded();
        const box = (await target.boundingBox())!;
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        await client.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x, y }],
        });
        for (let step = 1; step <= 8; step++) {
          await client.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{ x: x + (dx * step) / 8, y: y + (dy * step) / 8 }],
          });
          await page.evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() => resolve()),
              ),
          );
        }
        await client.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
        // A CDP acknowledgement can precede the compositor finishing the gesture.
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              ),
            ),
        );
      };
      const metrics = () => build.locator(".buildOptionMetrics").first();
      const selected = (name: string) =>
        expect(build.getByRole("tab", { name, exact: true })).toHaveAttribute(
          "aria-selected",
          "true",
        );
      await swipe(metrics(), 80);
      await selected("Generators");
      await swipe(metrics(), -80);
      await selected("Storage");
      await swipe(metrics(), -80);
      await selected("Interties");
      await swipe(build.locator(".constructionInterties h6").first(), -80);
      await selected("Interties");
      await swipe(build.locator(".constructionInterties h6").first(), 80);
      await selected("Storage");
      await swipe(metrics(), 80);
      await selected("Generators");
      const slider = build.getByRole("slider");
      const previousValue = await slider.getAttribute("aria-valuenow");
      await swipe(build.locator(".constructionCapacitySlider"), -70);
      await selected("Generators");
      await expect(slider).not.toHaveAttribute("aria-valuenow", previousValue!);
      await swipe(build.locator(".constructionCapacity"), -70);
      await selected("Generators");
      const scroller = build.locator(".scrollable").first();
      const beforeScroll = await scroller.evaluate((el) => el.scrollTop);
      await swipe(metrics(), 0, -180);
      await selected("Generators");
      await expect
        .poll(() => scroller.evaluate((el) => el.scrollTop))
        .toBeGreaterThan(beforeScroll + 100);
      await client.detach();
    });

    test(`pricing uses equal columns and the program catalog omits zero rollout in ${theme}`, async ({
      page,
    }, info) => {
      await page.goto("/?scenario=106");
      await page
        .getByRole("button", { name: "Start game", exact: true })
        .click();
      await page.locator("#programsNav").click();
      const programs = page.getByRole("region", {
        name: "Programs",
        exact: true,
      });
      const metrics = programs.locator(".insightsRateMetric");
      await expect(metrics).toHaveCount(3);
      const widths = await metrics.evaluateAll((els) =>
        els.map((el) => el.getBoundingClientRect().width),
      );
      expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1);
      await expect(
        programs.getByRole("button", {
          name: /^Smart heating and hot water · Off$/,
        }),
      ).toBeVisible();
      await expect(programs).not.toContainText("rollout 0%");
      if (
        process.env.REVIEW_SCREENSHOT_DIR &&
        theme === "dark" &&
        info.project.name === "mobile-390px"
      ) {
        await expect(programs.locator(".insightsRateScore")).not.toHaveText(
          "Calculating…",
          { timeout: 30000 },
        );
        await page.mouse.move(0, 0);
        await expect(page.getByRole("tooltip")).not.toBeVisible();
        await page.screenshot({
          path: path.join(
            process.env.REVIEW_SCREENSHOT_DIR,
            "programs-mobile.png",
          ),
          animations: "disabled",
        });
      }
    });

    test(`Insights shares the widest measured left axis and releases removed layers in ${theme}`, async ({
      page,
    }, info) => {
      await page.goto("/?scenario=106");
      await page
        .getByRole("button", { name: "Start game", exact: true })
        .click();
      const insights = page.locator(".insights:visible");
      await openPane(insights, page.locator("#insightsNav"));
      await page.evaluate(() => document.fonts.ready);
      const plots = insights.locator(".u-over");
      await expect.poll(() => plots.count()).toBeGreaterThanOrEqual(7);
      const insets = () =>
        plots.evaluateAll((els) =>
          els.map(
            (el) =>
              el.getBoundingClientRect().left -
              el.closest(".uplot")!.getBoundingClientRect().left,
          ),
        );
      const aligned = async () => {
        await expect
          .poll(async () => {
            const left = await insets();
            return Math.max(...left) - Math.min(...left);
          })
          .toBeLessThanOrEqual(1);
      };
      await aligned();
      await expectRightInsets(insights);
      const wide = Math.max(...(await insets()));
      await insights.getByRole("button", { name: /^Layers \(/ }).click();
      for (const label of [
        "Fuel Prices",
        "Cash",
        "Demand by use",
        "Temperature",
        "Water",
      ]) {
        const remove = insights.getByRole("button", {
          name: `Remove ${label}`,
          exact: true,
        });
        if (await remove.count()) await remove.click();
      }
      await expect(plots).toHaveCount(3);
      await aligned();
      await expectRightInsets(insights);
      // Leave only the shorter percentage labels, so a removed MW axis is necessarily wider.
      await insights
        .getByRole("button", { name: "Remove Supply by Fuel", exact: true })
        .click();
      await insights
        .getByRole("button", { name: "Remove Supply & Demand", exact: true })
        .click();
      await expect(plots).toHaveCount(1);
      await expect
        .poll(async () => Math.max(...(await insets())))
        .toBeLessThan(wide);
      await insights
        .getByRole("checkbox", { name: "Supply by Fuel", exact: true })
        .check();
      await insights
        .getByRole("checkbox", { name: "Supply & Demand", exact: true })
        .check();
      await insights
        .getByRole("checkbox", { name: "Renewable output", exact: true })
        .uncheck();
      await expect(plots).toHaveCount(2);
      await aligned();
      // Compare design units: the old 60-unit reserve grows with the chart's scale.
      const width = await plots
        .first()
        .evaluate(
          (element) => element.closest(".uplot")!.getBoundingClientRect().width,
        );
      await expect
        .poll(async () => Math.max(...(await insets())) / chartScale(width))
        .toBeLessThan(60);
      await insights
        .getByRole("button", { name: "Done choosing layers" })
        .click();
      if (
        process.env.REVIEW_SCREENSHOT_DIR &&
        theme === "dark" &&
        ["desktop-chromium", "mobile-390px"].includes(info.project.name)
      ) {
        await insights
          .locator(".insightsTrackHeader")
          .first()
          .scrollIntoViewIfNeeded();
        await page.mouse.move(0, 0);
        await expect(page.getByRole("tooltip")).not.toBeVisible();
        await page.screenshot({
          path: path.join(
            process.env.REVIEW_SCREENSHOT_DIR,
            `insights-${info.project.name}.png`,
          ),
          animations: "disabled",
        });
      }
    });

    test(`Insights right gutters match the title inset with Larger text in ${theme}`, async ({
      page,
    }) => {
      await page.addInitScript(() =>
        localStorage.setItem("textSize", "larger"),
      );
      await page.goto("/?scenario=106");
      await expect(page.locator("html")).toHaveAttribute(
        "data-text-size",
        "larger",
      );
      await page
        .getByRole("button", { name: "Start game", exact: true })
        .click();
      const insights = page.locator(".insights:visible");
      await openPane(insights, page.locator("#insightsNav"));
      await expect
        .poll(() => insights.locator(".u-over").count())
        .toBeGreaterThanOrEqual(7);
      await expectRightInsets(insights);
    });
  });
}
