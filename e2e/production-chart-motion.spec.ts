import path from "node:path";
import { expect, Page, test } from "./fixtures";
import { openPane } from "./layout";

declare global {
  interface Window {
    __productionMotion?: {
      samples: Array<{ x: number; at: number }>;
      canvasDraws: number;
    };
    __reducedMotionChange?: Promise<void>;
  }
}
function interpolates(
  samples: NonNullable<Window["__productionMotion"]>["samples"],
) {
  return (
    samples
      .slice(1)
      .filter(
        (sample, i) =>
          sample.x > samples[i].x &&
          sample.at - samples[i].at > 0 &&
          sample.at - samples[i].at < 150,
      ).length >= 2
  );
}
async function start(page: Page, theme: string, textSize = "standard") {
  // Drive the real chart/tick timers on one clock. Shared-runner scheduling must not turn
  // a 100 ms midpoint into a >150 ms gap or move ticks outside the observation window.
  await page.clock.install();
  await page.addInitScript(
    ({ mode, size }) => {
      localStorage.clear();
      localStorage.setItem("audioEnabled", "false");
      localStorage.setItem("theme", mode);
      localStorage.setItem("textSize", size);
    },
    { mode: theme, size: textSize },
  );
  await page.goto("/?scenario=103");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  const pane = page.locator(".facilities:visible");
  await openPane(
    pane,
    page.getByRole("button", { name: "Facilities", exact: true }),
  );
  await page.locator("#chartSupplyDemand .u-wrap > canvas").waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 200);
  await page.evaluate(() => {
    const probe = {
      samples: [] as Array<{ x: number; at: number }>,
      canvasDraws: 0,
    };
    window.__productionMotion = probe;
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      if (this.canvas.matches("#chartSupplyDemand .u-wrap > canvas"))
        probe.canvasDraws++;
      return clear.apply(this, args);
    };
    const observe = () => {
      const marker = document.querySelector<HTMLElement>(
        "#chartSupplyDemand [data-production-now]",
      );
      if (marker && getComputedStyle(marker).display !== "none") {
        const x =
          marker.getBoundingClientRect().x -
          marker.parentElement!.getBoundingClientRect().x;
        if (x !== probe.samples.at(-1)?.x)
          probe.samples.push({ x, at: performance.now() });
      }
      requestAnimationFrame(observe);
    };
    requestAnimationFrame(observe);
  });
  await page.mouse.move(0, 0);
  return pane;
}
async function setReducedMotion(
  page: Page,
  reducedMotion: "reduce" | "no-preference",
) {
  // The chart snaps from its own matchMedia change listener. This one is registered later, so
  // it resolves after the chart has reacted, before the next sample starts.
  await page.evaluate(() => {
    window.__reducedMotionChange = new Promise((resolve) =>
      window
        .matchMedia("(prefers-reduced-motion: reduce)")
        .addEventListener("change", () => resolve(), { once: true }),
    );
  });
  await page.emulateMedia({ reducedMotion });
  await page.evaluate(() => window.__reducedMotionChange);
}
async function sample(page: Page) {
  await page.evaluate(() => {
    window.__productionMotion!.samples = [];
    window.__productionMotion!.canvasDraws = 0;
  });
  await page.clock.runFor(600);
  return page.evaluate(() => window.__productionMotion!);
}

test("1x smoothly advances Now with stationary curves, then snaps for inspection and pause", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  if (info.project.name === "desktop-chromium")
    await page.setViewportSize({ width: 1920, height: 1080 });
  const pane = await start(
    page,
    info.project.name.startsWith("mobile") ? "dark" : "light",
  );
  const appbar = page.locator("#appbar:visible").first();
  const chart = pane.getByRole("img", {
    name: /electricity supply and demand over the day/,
  });
  const canvas = chart.locator(".u-wrap > canvas");
  const bounds = await canvas.boundingBox();
  await appbar.getByRole("button", { name: "slow speed", exact: true }).click();
  // The label stays clamped near the day's edges, then moves with the guide.
  await page.clock.runFor(1200);
  const motion = await sample(page);
  expect(interpolates(motion.samples)).toBe(true);
  expect(motion.canvasDraws).toBeGreaterThan(0);
  expect(motion.canvasDraws).toBeLessThanOrEqual(5);
  expect(await canvas.boundingBox()).toEqual(bounds);
  if (process.env.REVIEW_SCREENSHOT_DIR) {
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: path.join(
        process.env.REVIEW_SCREENSHOT_DIR,
        `chart-motion-${info.project.name}.png`,
      ),
    });
  }
  await chart.focus();
  await chart.press("Enter");
  await expect(chart.locator(".chartTooltip")).toContainText("Total supply");
  expect((await sample(page)).samples.length).toBeLessThanOrEqual(5);
  await chart.press("Escape");
  await expect(chart.locator(".chartTooltip")).toBeHidden();
  await appbar
    .getByRole("button", { name: "normal speed", exact: true })
    .click();
  expect((await sample(page)).samples).toHaveLength(0);
  await appbar.getByRole("button", { name: "slow speed", exact: true }).click();
  expect(interpolates((await sample(page)).samples)).toBe(true);
  await appbar.getByRole("button", { name: "pause", exact: true }).click();
  expect((await sample(page)).samples).toHaveLength(0);
});

test("reduced motion can change during 1x play without leaving interpolation active", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await start(page, "dark");
  await page
    .locator("#appbar:visible")
    .first()
    .getByRole("button", { name: "slow speed", exact: true })
    .click();
  await page.clock.runFor(1200);
  expect((await sample(page)).samples.length).toBeLessThanOrEqual(5);
  await setReducedMotion(page, "no-preference");
  expect(interpolates((await sample(page)).samples)).toBe(true);
  await setReducedMotion(page, "reduce");
  expect((await sample(page)).samples.length).toBeLessThanOrEqual(5);
});

test.describe("larger chart text at high pixel density", () => {
  test.use({ deviceScaleFactor: 2 });
  test("Now stays above the plot and inside its canvas", async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "desktop-chromium");
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await start(page, "dark", "larger");
    await page
      .locator("#appbar:visible")
      .first()
      .getByRole("button", { name: "slow speed", exact: true })
      .click();
    await page.clock.runFor(2000);
    const marker = page.locator("#chartSupplyDemand [data-production-now]");
    await expect(marker).toBeVisible();
    const label = await marker.locator("span").boundingBox();
    const plot = await page.locator("#chartSupplyDemand .u-over").boundingBox();
    const canvas = await page
      .locator("#chartSupplyDemand .u-wrap > canvas")
      .boundingBox();
    expect(label!.y + label!.height).toBeLessThan(plot!.y);
    expect(label!.x).toBeGreaterThanOrEqual(canvas!.x);
    expect(label!.x + label!.width).toBeLessThanOrEqual(
      canvas!.x + canvas!.width,
    );
    await expect(marker.locator("span")).toHaveCount(1);
    const motion = await sample(page);
    expect(interpolates(motion.samples)).toBe(true);
    expect(motion.canvasDraws).toBeLessThanOrEqual(5);
  });
});
