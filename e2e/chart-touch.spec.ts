import { expect, test, type Locator, type Page } from "./fixtures";
import { openPane } from "./layout";
import path from "path";

async function restoreMouseAfterTouch(page: Page, chart: Locator) {
  const plot = chart.locator(".u-over");
  const tooltip = chart.locator(".chartTooltip");
  await plot.scrollIntoViewIfNeeded();
  const box = (await plot.boundingBox())!;
  const x = Math.round(box.x + box.width * 0.4);
  const y = Math.round(box.y + box.height * 0.5);
  await page.mouse.move(x, y);
  await expect(tooltip).toBeVisible();
  const session = await page.context().newCDPSession(page);
  let touching = false;
  try {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { id: 0, x, y },
        { id: 1, x: x + 30, y },
      ],
    });
    touching = true;
    await expect(tooltip).toBeHidden();
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    touching = false;
    await page.mouse.move(x + 60, y);
    await expect(tooltip).toBeVisible();
  } finally {
    try {
      if (touching)
        await session.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
    } finally {
      await session.detach();
    }
  }
}

async function ignoreForeignContact(page: Page, chart: Locator) {
  const plot = chart.locator(".u-over");
  await plot.scrollIntoViewIfNeeded();
  const box = (await plot.boundingBox())!;
  const initial = [
    await chart.getAttribute("data-viewport-min"),
    await chart.getAttribute("data-viewport-max"),
  ];
  // The page corner is outside the plot, so this contact belongs to the page,
  // even while its global TouchList accompanies moves in the chart.
  expect(box.y).toBeGreaterThan(1);
  const foreign = { id: 99, x: 1, y: 1 };
  const inside = (shift: number) => ({
    id: 0,
    x: Math.round(box.x + box.width * (0.35 + shift)),
    y: Math.round(box.y + box.height * 0.5),
  });
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [inside(0)],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [inside(0), foreign],
    });
    for (const shift of [0.04, 0.08, 0.12]) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [inside(shift), foreign],
      });
    }
    // Let the chart's scheduled range update and React layout settle before
    // asserting that unrelated contacts did not navigate this viewport.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    await expect(chart).toHaveAttribute("data-viewport-min", initial[0]!);
    await expect(chart).toHaveAttribute("data-viewport-max", initial[1]!);
  } finally {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await session.detach();
  }
}

async function navigateWithTwoFingers(
  page: Page,
  chart: Locator,
  staggered: boolean,
) {
  const plot = chart.locator(".u-over");
  await plot.scrollIntoViewIfNeeded();
  const box = (await plot.boundingBox())!;
  const session = await page.context().newCDPSession(page);
  const range = async () => [
    Number(await chart.getAttribute("data-viewport-min")),
    Number(await chart.getAttribute("data-viewport-max")),
  ];
  const initial = await range();
  const span = initial[1] - initial[0];
  const points = (shift: number, spread = 0.12) =>
    [-1, 1].map((side, id) => ({
      id,
      x:
        Math.round(box.x + box.width * (0.4 + shift)) +
        side * Math.round(box.width * spread),
      y: Math.round(box.y + box.height * 0.5 + shift * 100),
    }));
  try {
    if (staggered) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: points(0).slice(0, 1),
      });
    }
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: points(0),
    });
    await expect(chart.locator(".chartTooltip")).toBeHidden();
    // Translate both fingers together, including vertical movement that could let the
    // browser take over and cancel a pointer-based chart gesture.
    for (const shift of [0.04, 0.08, 0.12, 0.16]) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: points(shift),
      });
    }
    await expect.poll(async () => (await range())[0]).toBeLessThan(initial[0]);
    const panned = await range();
    expect(initial[0] - panned[0]).toBeGreaterThan(span * 0.1);
    expect(panned[1] - panned[0]).toBeCloseTo(span, 3);
    for (const spread of [0.16, 0.2, 0.24]) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: points(0.16, spread),
      });
    }
    await expect
      .poll(async () => {
        const next = await range();
        return next[1] - next[0];
      })
      .toBeLessThan(span * 0.6);
    expect((await plot.boundingBox())!.y).toBeCloseTo(box.y, 0);
    for (const spread of [0.2, 0.16, 0.12]) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: points(0.16, spread),
      });
    }
    await expect
      .poll(async () => {
        const next = await range();
        return next[1] - next[0];
      })
      .toBeCloseTo(span, 3);
  } finally {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await session.detach();
  }
  // Content above can reflow as the date window changes. Scroll anchoring may adjust
  // scrollTop, but the plot under the player's fingers must stay in place.
  expect((await plot.boundingBox())!.y).toBeCloseTo(box.y, 0);
  await expect
    .poll(() =>
      chart.evaluate(
        (element) =>
          element.closest<HTMLElement>(".scrollable, .expandedChartContent")!
            .style.overflowAnchor,
      ),
    )
    .toBe("");
  expect(await page.evaluate(() => window.visualViewport!.scale)).toBe(1);
  return range();
}

async function scrub(page: Page, chart: Locator, scroller?: Locator) {
  const plot = chart.locator(".u-over");
  await plot.scrollIntoViewIfNeeded();
  const box = (await plot.boundingBox())!;
  const scrollBefore = await scroller?.evaluate((el) => el.scrollTop);
  const session = await page.context().newCDPSession(page);
  const point = (fraction: number, y = 0.4) => ({
    x: Math.round(box.x + box.width * fraction),
    y: Math.round(box.y + box.height * y),
  });
  const tooltip = chart.locator(".chartTooltip");
  try {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [point(0.15)],
    });
    await expect(tooltip).toBeVisible();
    const first = await tooltip.textContent();
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [point(0.55, 0.43)],
    });
    await expect(tooltip).toBeVisible();
    await expect(tooltip).not.toHaveText(first!);
    const middle = await tooltip.textContent();
    // Horizontal inspection keeps following the finger without moving the page.
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [point(0.85, 0.46)],
    });
    await expect(tooltip).not.toHaveText(middle!);
    if (scroller) {
      await expect
        .poll(() => scroller.evaluate((el) => el.scrollTop))
        .toBe(scrollBefore);
    }
  } finally {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await session.detach();
  }
}

for (const theme of ["light", "dark"]) {
  test(`vertical one-finger swipes scroll Insights over every chart in ${theme}`, async ({
    page,
  }, info) => {
    test.skip(!info.project.use.hasTouch);
    await page.addInitScript((theme) => {
      localStorage.clear();
      localStorage.setItem("theme", theme);
      localStorage.setItem("audioEnabled", "false");
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
    await page.goto("/?scenario=107");
    await page.getByRole("button", { name: "Start game" }).click();
    const insights = page.locator(".insights:visible");
    await openPane(insights, page.locator("#insightsNav"));
    const scroller = insights.locator(".scrollable");
    const charts = insights.locator(".insightsTrack [role=img]");
    await expect(charts).toHaveCount(7);
    const session = await page.context().newCDPSession(page);
    try {
      for (const chart of await charts.all()) {
        const plot = chart.locator(".u-over");
        await plot.scrollIntoViewIfNeeded();
        const box = (await plot.boundingBox())!;
        const before = await scroller.evaluate((el) => el.scrollTop);
        const canScrollDown = await scroller.evaluate(
          (el) => el.scrollHeight - el.clientHeight - el.scrollTop > 160,
        );
        const dy = canScrollDown ? -140 : 140;
        const x = Math.round(box.x + box.width / 2);
        const y = Math.round(box.y + box.height / 2);
        await session.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x, y }],
        });
        await expect(chart.locator(".chartTooltip")).toBeVisible();
        for (let step = 1; step <= 8; step++) {
          await session.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{ x: x + step, y: y + (dy * step) / 8 }],
          });
        }
        await session.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
        await expect
          .poll(async () =>
            canScrollDown
              ? (await scroller.evaluate((el) => el.scrollTop)) - before
              : before - (await scroller.evaluate((el) => el.scrollTop)),
          )
          .toBeGreaterThan(60);
        await expect(chart.locator(".chartTooltip")).not.toBeVisible();
      }
    } finally {
      await session.detach();
    }
  });

  test(`overflowing breakdown details remain readable during touch scrolling in ${theme}`, async ({
    page,
  }, info) => {
    test.skip(!info.project.use.hasTouch);
    // A short viewport and the supported larger text setting make the real breakdown overflow.
    await page.setViewportSize({
      width: info.project.use.viewport!.width,
      height: 480,
    });
    await page.addInitScript((theme) => {
      localStorage.clear();
      localStorage.setItem("theme", theme);
      localStorage.setItem("audioEnabled", "false");
      localStorage.setItem("textSize", "larger");
    }, theme);
    await page.goto("/?scenario=107");
    await page.getByRole("button", { name: "Start game" }).click();
    const chart = page.locator("#chartSupplyDemand [role=img]");
    const plot = chart.locator(".u-over");
    await plot.scrollIntoViewIfNeeded();
    const session = await page.context().newCDPSession(page);
    const tooltip = chart.locator(".chartTooltip-breakdown");
    try {
      await chart.press("Enter");
      await expect(tooltip).toBeVisible();
      await expect
        .poll(() => tooltip.evaluate((el) => el.scrollHeight - el.clientHeight))
        .toBeGreaterThan(30);
      const bounds = (await tooltip.boundingBox())!;
      const x = Math.round(bounds.x + bounds.width / 2);
      const y = Math.round(bounds.y + bounds.height * 0.8);
      await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x, y }],
      });
      for (let step = 1; step <= 8; step++) {
        await session.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x, y: y - step * 8 }],
        });
      }
      await session.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await expect(tooltip).toBeVisible();
      await expect
        .poll(() => tooltip.evaluate((el) => el.scrollTop))
        .toBeGreaterThan(20);
    } finally {
      await session.detach();
    }
  });

  test(`touch drags inspect production, synced insights, and expanded charts in ${theme}`, async ({
    page,
  }, info) => {
    test.skip(!info.project.use.hasTouch);
    await page.addInitScript((theme) => {
      localStorage.clear();
      localStorage.setItem("theme", theme);
    }, theme);
    await page.goto("/?scenario=107");
    await page.getByRole("button", { name: "Start game" }).click();
    const production = page.locator("#chartSupplyDemand [role=img]");
    await scrub(page, production);
    await restoreMouseAfterTouch(page, production);
    const insights = page.locator(".insights:visible");
    await openPane(
      insights,
      page.getByRole("button", { name: "Insights", exact: true }),
    );
    await insights
      .getByRole("button", { name: "Zoom in", exact: true })
      .click();
    await insights.getByRole("button", { name: "Pan later" }).click();
    const chart = insights.locator('[data-layer="cash"] [role=img]');
    const range = await chart.getAttribute("data-viewport-min");
    await scrub(page, chart, insights.locator(".scrollable"));
    await restoreMouseAfterTouch(page, chart);
    await expect(chart).toHaveAttribute("data-viewport-min", range!);
    await ignoreForeignContact(page, chart);
    const moved = await navigateWithTwoFingers(page, chart, theme === "dark");
    const synced = insights.locator('[data-layer="supplyDemand"] [role=img]');
    await expect(synced).toHaveAttribute("data-viewport-min", String(moved[0]));
    await expect(synced).toHaveAttribute("data-viewport-max", String(moved[1]));
    await insights.getByRole("button", { name: "Expand Cash chart" }).click();
    const dialog = page.getByRole("dialog", { name: "Cash", exact: true });
    await scrub(page, dialog.getByRole("img"));
    await navigateWithTwoFingers(
      page,
      dialog.getByRole("img"),
      theme !== "dark",
    );
    if (process.env.REVIEW_SCREENSHOT_DIR) {
      await page.screenshot({
        path: path.join(
          process.env.REVIEW_SCREENSHOT_DIR,
          `cash-touch-${info.project.name}-${theme}.png`,
        ),
        animations: "disabled",
      });
    }
    await dialog.getByRole("button", { name: "Close Cash chart" }).click();
  });
}
