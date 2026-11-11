import path from "node:path";
import { expect, test, type Locator } from "./fixtures";
import { openBuild, openPane, sortBuildCatalog } from "./layout";
import { chartScale } from "../src/components/base/UPlotHelpers";
import { editSavedGame } from "./save-fixture";
import { MINUTES_PER_MONTH } from "../src/helpers/DateTime";

const scrollbarTest = test.extend({
  launchOptions: async ({ launchOptions }, use) => {
    await use({
      ...launchOptions,
      // Headless Chromium otherwise hides the scrollbars that trigger this feedback loop.
      ignoreDefaultArgs: [
        ...(Array.isArray(launchOptions.ignoreDefaultArgs)
          ? launchOptions.ignoreDefaultArgs
          : []),
        "--hide-scrollbars",
      ],
    });
  },
});

scrollbarTest.describe("Insights with space-taking scrollbars", () => {
  for (const theme of ["light", "dark"] as const) {
    scrollbarTest(
      `charts settle at the large-screen overflow boundary in ${theme}`,
      async ({ page }, info) => {
        scrollbarTest.skip(info.project.name !== "desktop-chromium");
        await page.setViewportSize({ width: 3840, height: 1080 });
        await page.addInitScript((mode) => {
          localStorage.clear();
          localStorage.setItem("theme", mode);
          localStorage.setItem(
            "insightsLayers",
            JSON.stringify([
              "supplyDemand",
              "cash",
              "emissions",
              "profit",
              "financeDetails",
            ]),
          );
        }, theme);
        await page.goto("/?scenario=108");
        // Use a predictable classic scrollbar width on every desktop platform.
        await page.addStyleTag({
          content:
            ".insights > .scrollable::-webkit-scrollbar { width: 15px; }",
        });
        await page
          .getByRole("button", { name: "Start game", exact: true })
          .click();
        const insights = page.locator(".insights:visible");
        await openPane(insights, page.locator("#insightsNav"));
        await expect(insights.locator(".uplot")).toHaveCount(4);
        await page.evaluate(() => document.fonts.ready);
        const scroller = insights.locator(":scope > .scrollable");
        await expect
          .poll(() =>
            scroller.evaluate((element) =>
              Math.round(
                element.getBoundingClientRect().width - element.clientWidth,
              ),
            ),
          )
          .toBe(15);
        // Wait for the chart's debounced options rebuild before measuring its content height.
        await page.waitForTimeout(250);
        const height = await scroller.evaluate(
          (element) =>
            innerHeight - element.clientHeight + element.scrollHeight + 1,
        );
        // The narrow charts just fit. Without a reserved gutter the scrollbar disappears,
        // widening and heightening them until they overflow and bring the scrollbar back.
        await page.setViewportSize({ width: 3840, height });
        const geometries = await insights.evaluate(
          (element) =>
            new Promise<string[]>((resolve) => {
              const samples: string[] = [];
              const sample = () => {
                samples.push(
                  JSON.stringify(
                    Array.from(element.querySelectorAll(".u-over"), (plot) => {
                      const { x, y, width, height } =
                        plot.getBoundingClientRect();
                      return [x, y, width, height];
                    }),
                  ),
                );
                if (samples.length < 90) requestAnimationFrame(sample);
                else resolve(samples.slice(30));
              };
              requestAnimationFrame(sample);
            }),
        );
        expect(
          new Set(geometries).size,
          "chart geometry settles after resizing",
        ).toBe(1);
        if (process.env.REVIEW_SCREENSHOT_DIR) {
          await page.mouse.move(0, 0);
          await page.screenshot({
            path: path.join(
              process.env.REVIEW_SCREENSHOT_DIR,
              `insights-4k-${theme}.png`,
            ),
            animations: "disabled",
          });
        }
      },
    );
  }
});

const expectRightInsets = async (insights: Locator) => {
  // Water uses this space for its reservoir axis; every other plot ends on the title guide.
  const tracks = insights.locator('.insightsTrack:not([data-layer="water"])');
  await expect
    .poll(() =>
      tracks.evaluateAll((elements) =>
        Math.max(
          ...elements.flatMap((track) => {
            const bounds = track.getBoundingClientRect();
            const title = track.querySelector(".insightsTrackHeader h3")!;
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
          ]),
        );
      }, theme);
    });

    test(`facility limits show available MW and their cause in ${theme}`, async ({
      page,
    }, info) => {
      await page.goto("/?scenario=108");
      await page
        .getByRole("button", { name: "Start game", exact: true })
        .click();
      await editSavedGame(page, (save) => {
        const game = save.game;
        game.speed = "PAUSED";
        const nuclear = game.facilities.find(
          (facility) => facility.fuel === "Uranium",
        )!;
        nuclear.peakW = 300e6;
        nuclear.currentW = 0;
        game.worldEvents.active.push({
          key: "review-heat",
          definitionId: "review-heat",
          startsMinute: game.date.minute,
          endsMinute: game.date.minute + MINUTES_PER_MONTH,
          attributes: {},
          title: "Extreme heat",
          effects: { facilityOutputMultipliersById: { [nuclear.id]: 0.98 } },
        });
      });
      await page.reload();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      const fleet = page.locator(".facilities");
      await openPane(
        fleet,
        page.getByRole("button", { name: "Facilities", exact: true }),
      );
      const nuclear = fleet.locator('.facilityRow[data-fuel="Uranium"]');
      await expect(nuclear.locator(".facilityStatus")).toContainText(
        "0/300 294MW",
      );
      await expect(nuclear.locator("s")).toHaveText("300");
      await expect(nuclear.locator("s")).toHaveCSS(
        "text-decoration-line",
        "line-through",
      );
      const limit = nuclear.getByText("98% limit", { exact: true });
      await expect(limit).toBeVisible();
      await limit.hover();
      await expect(page.getByRole("tooltip")).toHaveText(
        "Limited due to Extreme heat",
      );
      expect(
        await nuclear.evaluate((el) => el.scrollWidth - el.clientWidth),
      ).toBeLessThanOrEqual(1);
      if (process.env.REVIEW_SCREENSHOT_DIR) {
        await page.screenshot({
          path: path.join(
            process.env.REVIEW_SCREENSHOT_DIR,
            `facility-limits-${theme}-${info.project.name}.png`,
          ),
          animations: "disabled",
        });
      }
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
      await expect(plots).toHaveCount(6);
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
      for (const name of ["Revenue", "Expenses", "Renewable output"]) {
        await expect(
          insights.getByRole("checkbox", { name, exact: true }),
        ).toHaveCount(0);
      }
      if (
        process.env.REVIEW_SCREENSHOT_DIR &&
        theme === "dark" &&
        info.project.name === "desktop-chromium"
      ) {
        await page.mouse.move(0, 0);
        await page.screenshot({
          path: path.join(
            process.env.REVIEW_SCREENSHOT_DIR,
            "insight-layers-desktop.png",
          ),
          animations: "disabled",
        });
      }
      for (const label of ["Fuel Prices", "Cash", "Demand by use", "Water"]) {
        const remove = insights.getByRole("button", {
          name: `Remove ${label}`,
          exact: true,
        });
        if (await remove.count()) await remove.click();
      }
      await expect(plots).toHaveCount(3);
      await aligned();
      await expectRightInsets(insights);
      // Leave only the shorter temperature labels, so a removed MW axis is necessarily wider.
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
        .getByRole("checkbox", { name: "Temperature", exact: true })
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
      await expect(insights.locator(".u-over")).toHaveCount(6);
      await expectRightInsets(insights);
    });
  });
}

async function cardSpacing(card: Locator) {
  return card.evaluate((element) => {
    const style = getComputedStyle(element);
    const grid = getComputedStyle(
      element.querySelector(".buildOptionMetrics")!,
    );
    const list = getComputedStyle(element.parentElement!);
    return {
      margin: style.margin,
      gridPadding: grid.padding,
      gridGap: grid.gap,
      listPadding: list.padding,
    };
  });
}

async function expectFullRowFocus(row: Locator) {
  const disclosure = row.locator(".facilityDisclosure");
  await disclosure.scrollIntoViewIfNeeded();
  await disclosure.page().keyboard.press("Tab");
  await disclosure.focus();
  await expect(disclosure).toBeFocused();
  await expect
    .poll(() =>
      row.locator(".facilityRowHeader").evaluate((header) => {
        const ring = getComputedStyle(header, "::before");
        return {
          left: ring.left,
          right: ring.right,
          width: ring.borderLeftWidth,
          style: ring.borderLeftStyle,
          content: ring.content,
        };
      }),
    )
    .toEqual({
      left: "0px",
      right: "0px",
      width: "2px",
      style: "solid",
      content: '""',
    });
  // The commissioning flash uses ::after and must not hide keyboard focus, including
  // when reduced motion suppresses that flash.
  await row.page().emulateMedia({ reducedMotion: "reduce" });
  await row
    .locator(".facilityRowHeader")
    .evaluate((header) => header.classList.add("facilityReady"));
  expect(
    await row
      .locator(".facilityRowHeader")
      .evaluate((header) => getComputedStyle(header, "::before").opacity),
  ).toBe("1");
  await row
    .locator(".facilityRowHeader")
    .evaluate((header) => header.classList.remove("facilityReady"));
  await row.page().emulateMedia({ reducedMotion: "no-preference" });
  const header = (await row.locator(".facilityRowHeader").boundingBox())!;
  const pane = (await row.page().locator(".facilities:visible").boundingBox())!;
  expect(header.x).toBeGreaterThanOrEqual(pane.x);
  expect(header.x + header.width).toBeLessThanOrEqual(pane.x + pane.width);
}

for (const theme of ["light", "dark"] as const) {
  test(`construction cards share spacing and icon silhouettes in ${theme}`, async ({
    page,
  }, info) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=100");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const build = await openBuild(page);
    const layouts = [];
    const colors = [];
    for (const category of ["Generators", "Storage", "Interties"]) {
      await build.getByRole("tab", { name: category, exact: true }).click();
      if (category === "Storage")
        await build
          .getByRole("button", { name: "Use max size", exact: true })
          .click();
      if (category !== "Interties") {
        for (const label of ["Build time", "Build cost"]) {
          await sortBuildCatalog(page, label);
        }
      }
      const card =
        category === "Generators"
          ? build.locator(".buildOption").filter({
              has: page.getByRole("button", {
                name: "Review purchase of Solar",
                exact: true,
              }),
            })
          : build.locator(".buildOption").first();
      await expect(card).toBeVisible();
      layouts.push(await cardSpacing(card));
      const context = card.locator(
        category === "Storage"
          ? ".buildOptionDescription"
          : ".buildOptionContext",
      );
      colors.push(
        await context.evaluate((element) => getComputedStyle(element).color),
      );
      if (category !== "Generators") {
        const icon = card.locator(".MuiAvatar-root");
        await expect(icon).toHaveCSS("border-radius", "0px");
        if (category === "Storage")
          await expect(icon).toHaveCSS(
            "clip-path",
            "polygon(50% 0px, 100% 50%, 50% 100%, 0px 50%)",
          );
        else {
          await expect(icon).toHaveCSS(
            "clip-path",
            "polygon(50% 0px, 100% 100%, 0px 100%)",
          );
          await icon
            .locator("img")
            .evaluate((element) => (element as HTMLImageElement).decode());
        }
      }
      expect(
        await card.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
      if (process.env.REVIEW_SCREENSHOT_DIR && category === "Interties") {
        await page.screenshot({
          path: path.join(
            process.env.REVIEW_SCREENSHOT_DIR,
            `interties-${theme}-${info.project.name}.png`,
          ),
          animations: "disabled",
        });
      }
    }
    expect(layouts[1]).toEqual(layouts[0]);
    expect(layouts[2]).toEqual(layouts[0]);
    expect(colors[0]).toBe(colors[1]);
    expect(colors[2]).toBe(colors[1]);

    // Check the silhouettes and edge-to-edge focus after buying both kinds of project.
    await build
      .getByRole("button", {
        name: "Review purchase of Pacific Northwest intertie",
      })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Take loan" })
      .click();
    await openBuild(page);
    await build.getByRole("tab", { name: "Storage", exact: true }).click();
    await build
      .getByRole("button", {
        name: "Review purchase of Lithium Battery",
        exact: true,
      })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Take loan" })
      .click();
    await openPane(
      page.locator(".facilities"),
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    const battery = page.locator('.facilityRow[data-facility="Battery"]');
    await expect(battery.locator(".MuiAvatar-root")).toHaveCSS(
      "border-radius",
      "0px",
    );
    await expect(battery.locator(".MuiAvatar-root")).toHaveCSS(
      "clip-path",
      "polygon(50% 0px, 100% 50%, 50% 100%, 0px 50%)",
    );
    for (const row of [
      page.locator(".facilityRow").first(),
      page.locator(".transmissionLine").first(),
    ]) {
      await expectFullRowFocus(row);
    }
    await expect(page.locator(".transmissionListIcon").first()).toHaveCSS(
      "border-radius",
      "0px",
    );
    await expect(page.locator(".transmissionListIcon").first()).toHaveCSS(
      "clip-path",
      "polygon(50% 0px, 100% 100%, 0px 100%)",
    );
    await page
      .locator(".transmissionListIcon")
      .first()
      .evaluate((element) => (element as HTMLImageElement).decode());
    if (process.env.REVIEW_SCREENSHOT_DIR) {
      await page.mouse.move(0, 0);
      await expect(page.locator(".snackbarContent")).toBeHidden();
      await page.screenshot({
        path: path.join(
          process.env.REVIEW_SCREENSHOT_DIR,
          `facilities-${theme}-${info.project.name}.png`,
        ),
        animations: "disabled",
      });
    }
  });

  test(`operating intertie badges leave the exchange arrow clear in ${theme}`, async ({
    page,
  }, info) => {
    await page.addInitScript((mode) => {
      localStorage.clear();
      localStorage.setItem("theme", mode);
      localStorage.setItem("audioEnabled", "false");
    }, theme);
    await page.goto("/?scenario=111");
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    await openPane(
      page.locator(".facilities:visible"),
      page.getByRole("button", { name: "Facilities", exact: true }),
    );
    const line = page.locator(".transmissionLine").first();
    const icon = line.locator(".transmissionIcon");
    const badge = icon.locator(".facilityActivity");
    await expect(badge).toBeVisible();
    await line
      .locator(".transmissionListIcon")
      .evaluate((element) => (element as HTMLImageElement).decode());
    await line.scrollIntoViewIfNeeded();
    const iconBounds = (await icon.boundingBox())!;
    const badgeBounds = (await badge.boundingBox())!;
    // The exchange arrow occupies the triangle's lower half. Nest the flow badge in
    // the open upper-right corner, clear of both arrowheads.
    expect(badgeBounds.y + badgeBounds.height).toBeLessThanOrEqual(
      iconBounds.y + iconBounds.height / 2,
    );
    expect(badgeBounds.x).toBeGreaterThanOrEqual(
      iconBounds.x + iconBounds.width / 2,
    );
    if (process.env.REVIEW_SCREENSHOT_DIR) {
      await page.screenshot({
        path: path.join(
          process.env.REVIEW_SCREENSHOT_DIR,
          `operating-${theme}-${info.project.name}.png`,
        ),
        animations: "disabled",
      });
      await line.screenshot({
        path: path.join(
          process.env.REVIEW_SCREENSHOT_DIR,
          `operating-row-${theme}-${info.project.name}.png`,
        ),
        animations: "disabled",
      });
    }
  });
}
