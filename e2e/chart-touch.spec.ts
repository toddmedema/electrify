import { expect, test, type Locator, type Page } from "./fixtures";
import { openPane } from "./layout";

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
    await scrub(page, page.locator("#chartSupplyDemand [role=img]"));
    const insights = page.locator(".insights:visible");
    await openPane(
      insights,
      page.getByRole("button", { name: "Insights", exact: true }),
    );
    await insights
      .getByRole("button", { name: "Zoom in", exact: true })
      .click();
    const chart = insights.locator('[data-layer="cash"] [role=img]');
    const range = await chart.getAttribute("data-viewport-min");
    await scrub(page, chart, insights.locator(".scrollable"));
    await expect(chart).toHaveAttribute("data-viewport-min", range!);
    // Two fingers retain the shared zoom gesture after one-finger inspection.
    const plotBox = (await chart.locator(".u-over").boundingBox())!;
    const session = await page.context().newCDPSession(page);
    const y = Math.round(plotBox.y + plotBox.height * 0.8);
    const center = Math.round(plotBox.x + plotBox.width / 2);
    const span = async () =>
      Number(await chart.getAttribute("data-viewport-max")) -
      Number(await chart.getAttribute("data-viewport-min"));
    const initialSpan = await span();
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: center - 20, y },
        { x: center + 20, y },
      ],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: center - 60, y },
        { x: center + 60, y },
      ],
    });
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await session.detach();
    await expect.poll(span).toBeLessThan(initialSpan);
    await insights.getByRole("button", { name: "Expand Cash chart" }).click();
    const dialog = page.getByRole("dialog", { name: "Cash", exact: true });
    await scrub(page, dialog.getByRole("img"));
    await dialog.getByRole("button", { name: "Close Cash chart" }).click();
  });
}
