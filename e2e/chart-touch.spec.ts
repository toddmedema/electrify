import { expect, test, type Locator, type Page } from "./fixtures";
import { openPane } from "./layout";
import path from "path";

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

async function scrub(page: Page, chart: Locator) {
  const plot = chart.locator(".u-over");
  await plot.scrollIntoViewIfNeeded();
  const box = (await plot.boundingBox())!;
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
      touchPoints: [point(0.55, 0.65)],
    });
    await expect(tooltip).toBeVisible();
    await expect(tooltip).not.toHaveText(first!);
    const middle = await tooltip.textContent();
    // Continue the same gesture vertically as well as horizontally: scrolling must not cancel it.
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [point(0.85, 0.2)],
    });
    await expect(tooltip).not.toHaveText(middle!);
  } finally {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await session.detach();
  }
}

for (const theme of ["light", "dark"]) {
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
    await insights.getByRole("button", { name: "Pan later" }).click();
    const chart = insights.locator('[data-layer="cash"] [role=img]');
    const range = await chart.getAttribute("data-viewport-min");
    await scrub(page, chart);
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
