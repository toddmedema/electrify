// Production timing evidence: E2E_CPU_RATE=4 npm run test:e2e:production --
// side-panel-performance.spec.ts --project=desktop-1440px --workers=1
// Timings are reports, never machine-dependent assertions.
import { expect, test } from "./fixtures";
import { openBuild, waitForSettled } from "./layout";
import { reviewScreenshot } from "./review-screenshot";

const panels = [
  "Fleet",
  "Generators",
  "Storage",
  "Interties",
  "Programs",
  "Insights",
  "Events",
  "Scenario",
  "Multiple",
] as const;

for (const panel of panels) {
  for (const speed of ["normal", "ultra"] as const) {
    test(`${panel} at ${speed} speed`, async ({ page }, info) => {
      test.skip(info.project.name !== "desktop-1440px");
      test.setTimeout(120_000);
      const cdp = await page.context().newCDPSession(page);
      const rate = Number(process.env.E2E_CPU_RATE || "1");
      expect(Number.isFinite(rate) && rate >= 1).toBe(true);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate });
      await page.addInitScript(() => {
        localStorage.clear();
        localStorage.setItem("audioEnabled", "false");
        let seed = 12345;
        Math.random = () =>
          ((seed = (Math.imul(seed, 1664525) + 1013904223) | 0) >>> 0) /
          4294967296;
      });
      await page.goto("/?scenario=103");
      await page
        .getByRole("button", { name: "Start game", exact: true })
        .click();
      await waitForSettled(page, "#appbar");
      if (["Generators", "Storage", "Interties"].includes(panel)) {
        await openBuild(page);
        if (panel !== "Generators")
          await page.getByRole("tab", { name: panel, exact: true }).click();
      } else if (panel !== "Fleet") {
        if (panel === "Multiple") {
          // Enough space for three simultaneously visible tools plus the fleet.
          await page.setViewportSize({ width: 1920, height: 1080 });
          await openBuild(page);
          await page
            .getByRole("button", { name: "Programs", exact: true })
            .click();
          await page
            .getByRole("button", { name: "Scenario", exact: true })
            .click();
          await expect(page.locator(".gameStage")).toHaveAttribute(
            "data-panel-count",
            "3",
          );
        } else
          await page.getByRole("button", { name: panel, exact: true }).click();
      }
      if (panel === "Insights")
        await expect(
          page.locator("#insightsPane .uplot").first(),
        ).toBeVisible();
      if (panel === "Generators" || panel === "Multiple")
        await expect(
          page.getByRole("button", {
            name: "Review purchase of Solar",
            exact: true,
          }),
        ).toBeVisible();
      const date = page.locator("#appbar .gameStatus .weak").first();
      const start = await date.textContent();
      await cdp.send("Profiler.enable");
      await cdp.send("Profiler.start");
      await page
        .getByRole("button", { name: `${speed} speed`, exact: true })
        .click();
      const samples = await page.evaluate(async () => {
        const gaps: number[] = [];
        const tasks: number[] = [];
        const observer = new PerformanceObserver((list) =>
          list.getEntries().forEach((entry) => tasks.push(entry.duration)),
        );
        observer.observe({ type: "longtask" });
        const start = performance.now();
        let previous = start;
        await new Promise<void>((resolve) => {
          const frame = (at: number) => {
            gaps.push(at - previous);
            previous = at;
            if (at - start >= 5000) resolve();
            else requestAnimationFrame(frame);
          };
          requestAnimationFrame(frame);
        });
        observer.disconnect();
        return { gaps, tasks, elapsedMs: performance.now() - start };
      });
      await page.getByRole("button", { name: "pause", exact: true }).click();
      const { profile } = await cdp.send("Profiler.stop");
      const end = await date.textContent();
      expect(end).not.toBe(start);
      if (panel === "Multiple" && speed === "normal")
        await reviewScreenshot(page, {
          path: info.outputPath("desktop-side-panels.png"),
          animations: "disabled",
        });
      const sorted = [...samples.gaps].sort((a, b) => a - b);
      const report = {
        panel,
        speed,
        cpuRate: rate,
        start,
        end,
        elapsedMs: samples.elapsedMs,
        frames: sorted.length,
        p50Ms: sorted[Math.floor(sorted.length * 0.5)],
        p95Ms: sorted[Math.floor(sorted.length * 0.95)],
        worstMs: sorted[sorted.length - 1],
        longTasks: samples.tasks.length,
        longestTaskMs: Math.max(0, ...samples.tasks),
      };
      console.log(JSON.stringify(report)); // eslint-disable-line no-console
      await info.attach("panel-timing.json", {
        body: JSON.stringify(report, null, 2),
        contentType: "application/json",
      });
      await info.attach("panel.cpuprofile", {
        body: JSON.stringify(profile),
        contentType: "application/json",
      });
    });
  }
}
