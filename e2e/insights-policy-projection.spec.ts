import { expect, test } from "./fixtures";
import { openPane } from "./layout";

declare global {
  interface Window {
    __policyWorkerProbe?: { responses: number };
  }
}

test("paused insights refresh customer programs and keep chart zoom after a palette change", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("insightsLayers", JSON.stringify(["supplyDemand"]));
    const probe = { responses: 0 };
    Object.assign(window, { __policyWorkerProbe: probe });
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener("message", ({ data }) => {
          // Policy estimates must come from a working worker, even when a
          // failed chunk could otherwise be hidden by the main-thread fallback.
          if (
            Array.isArray(data?.result?.current) &&
            Array.isArray(data?.result?.changed)
          ) {
            probe.responses++;
          }
        });
      }
    };
  });
  await page.goto("/?scenario=106");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  const insights = page.locator(".insights:visible");
  const insightsButton = page.getByRole("button", {
    name: "Insights",
    exact: true,
  });
  await openPane(insights, insightsButton);
  const chart = insights.locator(".accessibleChart [role=img]").first();
  await expect(chart).toHaveAttribute("aria-label", /Forecast demand/);
  const before = await chart.getAttribute("aria-label");
  const programs = page.getByRole("region", { name: "Programs", exact: true });
  await openPane(
    programs,
    page.getByRole("button", { name: "Programs", exact: true }),
  );
  await programs
    .getByRole("button", { name: /Efficiency.*Not started/i })
    .click();
  const start = programs.getByRole("button", { name: "Start next month" });
  await expect(start).toBeEnabled({ timeout: 30000 });
  await expect
    .poll(() => page.evaluate(() => window.__policyWorkerProbe?.responses ?? 0))
    .toBeGreaterThan(0);
  await start.click();
  await expect(
    programs.getByRole("button", { name: /Efficiency.*starts Feb 2020/i }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(programs).toHaveCount(0);
  await openPane(insights, insightsButton);
  await expect(chart).not.toHaveAttribute("aria-label", before!);
  const span = async () =>
    Number(await chart.getAttribute("data-viewport-max")) -
    Number(await chart.getAttribute("data-viewport-min"));
  const zoom = async () => {
    const initialSpan = await span();
    await insights
      .getByRole("button", { name: "Zoom in", exact: true })
      .click();
    await expect.poll(span).toBeLessThan(initialSpan);
  };
  await zoom();
  const zoomedSpan = await span();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await span()).toBe(zoomedSpan);
  await zoom();
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: testInfo.outputPath("insights-program-zoom-dark.png"),
  });
});
