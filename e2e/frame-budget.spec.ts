// Real animation-frame callbacks, with no Playwright clock or development-only store hook. This
// runs unchanged against a production server through E2E_BASE_URL. Functional progress is
// asserted; wall-clock durations are attached evidence, never machine-dependent CI gates.
// Use --headed on the target computer to sample its callback cadence; a headless browser may
// run at 60 Hz even when the physical display supports 120 Hz. E2E_CPU_RATE is a lab proxy only.
import { expect, Page, test } from "./fixtures";
import fs from "fs";
import { openPane, waitForSettled, openBuild } from "./layout";

interface FrameGap {
  at: number;
  duration: number;
}

interface Boundary {
  at: number;
  from: string;
  to: string;
  year: boolean;
}

interface FrameProbe {
  gaps: FrameGap[];
  boundaries: Boundary[];
  longTasks: FrameGap[];
  longTaskSupported: boolean;
  idleGaps: number[];
  measuring: boolean;
  stop: () => void;
}

declare global {
  interface Window {
    __frameProbe?: FrameProbe;
  }
}

async function installProbe(page: Page) {
  // Choose the settled, visible appbar once. Observe only its text changes instead of forcing
  // layout or reading the DOM at every frame; the production store stays unmodified.
  await page
    .locator("#appbar:visible .gameStatus .weak")
    .first()
    .evaluate((date) => {
      const month = () => date.textContent!.match(/[A-Za-z]+ \d+/)![0];
      const probe: FrameProbe = {
        gaps: [],
        boundaries: [],
        longTasks: [],
        idleGaps: [],
        measuring: false,
        longTaskSupported: (
          PerformanceObserver.supportedEntryTypes ?? []
        ).includes("longtask"),
        stop: () => undefined,
      };
      window.__frameProbe = probe;
      let label = month();
      let previous: number | undefined;
      const observer = new MutationObserver(() => {
        const next = month();
        if (next === label) return;
        if (probe.measuring) {
          probe.boundaries.push({
            at: performance.now(),
            from: label,
            to: next,
            year: next.split(" ")[1] !== label.split(" ")[1],
          });
        }
        label = next;
      });
      observer.observe(date, {
        subtree: true,
        characterData: true,
        childList: true,
      });
      let taskObserver: PerformanceObserver | undefined;
      if (probe.longTaskSupported) {
        taskObserver = new PerformanceObserver((list) => {
          if (!probe.measuring) return;
          for (const entry of list.getEntries()) {
            probe.longTasks.push({
              at: entry.startTime,
              duration: entry.duration,
            });
          }
        });
        taskObserver.observe({ type: "longtask" });
      }
      let raf = 0;
      const frame = (at: number) => {
        if (previous !== undefined) {
          const gap = at - previous;
          if (probe.measuring) probe.gaps.push({ at, duration: gap });
          else probe.idleGaps.push(gap);
        }
        previous = at;
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      probe.stop = () => {
        cancelAnimationFrame(raf);
        observer.disconnect();
        taskObserver?.disconnect();
      };
    });
}

function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ??
    0
  );
}

function summarize(gaps: FrameGap[], budgetMs: number, displayMs: number) {
  const values = gaps.map(({ duration }) => duration);
  return {
    frames: values.length,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    worstMs: Math.max(0, ...values),
    overTargetBudget: values.filter((gap) => gap > budgetMs + 0.5).length,
    // Estimated skipped idle-cadence intervals, not measured physical presentation frames.
    missedDisplayFrames: values.reduce(
      (total, gap) => total + Math.max(0, Math.round(gap / displayMs) - 1),
      0,
    ),
  };
}

const journeys = [
  { name: "main panes", scenario: 103, pane: "facilities" },
  { name: "Insights", scenario: 103, pane: "insights" },
  { name: "hydro outlook", scenario: 108, pane: "hydro" },
  { name: "intertie outlook", scenario: 101, pane: "intertie" },
] as const;

for (const journey of journeys) {
  test(`real frames at target speed through month and year boundaries: ${journey.name}`, async ({
    page,
  }, testInfo) => {
    const desktop = testInfo.project.name === "desktop-1440px";
    test.skip(!desktop && testInfo.project.name !== "mobile-390px");
    // At desktop width both core panes are already mounted; a second identical sample would
    // add noise. The phone needs an independent run with its chart-heavy pane visible.
    test.skip(desktop && journey.pane === "insights");
    test.setTimeout(120_000);
    const cpuRate = Number(process.env.E2E_CPU_RATE || "1");
    expect(Number.isFinite(cpuRate), "E2E_CPU_RATE must be finite").toBe(true);
    expect(cpuRate, "E2E_CPU_RATE must be at least 1").toBeGreaterThanOrEqual(
      1,
    );
    if (cpuRate !== 1) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuRate });
    }
    await page.addInitScript(() => {
      localStorage.clear();
      localStorage.setItem("audioEnabled", "false");
      localStorage.setItem("theme", "light");
      // Use the same seeded new run on every host/build, independently of cosmetic draws.
      let seed = 0;
      Math.random = () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      document.addEventListener("click", () => (seed = 0x5eed), true);
    });
    await page.goto(`/?scenario=${journey.scenario}`);
    await page.getByRole("button", { name: "Start game", exact: true }).click();
    const appbar = page.locator("#appbar:visible").first();
    const pause = appbar.getByRole("button", { name: "pause", exact: true });
    await expect(pause).toHaveAttribute("aria-pressed", "true");
    await openPane(
      page.locator(journey.pane === "insights" ? ".insights" : ".facilities"),
      page.getByRole("button", {
        name: journey.pane === "insights" ? "Insights" : "Facilities",
        exact: true,
      }),
    );
    if (journey.pane === "hydro") {
      await page.locator('[data-facility="Hydro"] .facilityDisclosure').click();
      await expect(
        page.getByRole("region", { name: "Water", exact: true }),
      ).toBeVisible();
    }
    if (journey.pane === "intertie") {
      const facilities = page.locator(".facilities:visible");
      await openBuild(page);
      await page.getByRole("tab", { name: "Interties", exact: true }).click();
      await page
        .getByRole("button", {
          name: "Review purchase of Pacific Northwest intertie",
          exact: true,
        })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Take loan", exact: true })
        .click();
      const line = facilities.locator(".transmissionLine").first();
      await expect(line).toBeVisible();
      await line.locator(".facilityDisclosure").click();
      await expect(
        line.getByRole("figure", { name: /^Typical year/ }),
      ).toBeVisible();
    }
    await waitForSettled(page, "#appbar");
    await installProbe(page);
    // Measure idle animation-frame cadence before starting game time. A 60 Hz callback stream
    // cannot demonstrate the 120 Hz target, even when its ordinary tick work is inexpensive.
    await expect
      .poll(() => page.evaluate(() => window.__frameProbe!.idleGaps.length))
      .toBeGreaterThanOrEqual(30);
    const speed = appbar.getByRole("button", {
      name: desktop ? "ultra speed" : "fast speed",
      exact: true,
    });
    await expect(speed).toHaveText(desktop ? "24×" : "12×");
    await page.evaluate(() => {
      window.__frameProbe!.measuring = true;
    });
    await speed.click();
    await expect
      .poll(() => page.evaluate(() => window.__frameProbe!.boundaries.length), {
        timeout: 90_000,
      })
      .toBeGreaterThanOrEqual(12);
    // Include deferred forecasts and year-save work following the final rollover.
    await page.waitForTimeout(350);
    const result = await page.evaluate(() => {
      const probe = window.__frameProbe!;
      probe.stop();
      return {
        gaps: probe.gaps,
        boundaries: probe.boundaries,
        longTasks: probe.longTasks,
        idleGaps: probe.idleGaps,
        longTaskSupported: probe.longTaskSupported,
        developmentInstruments: Boolean(window.__perf),
        mainScript: Array.from(document.scripts).find((script) =>
          script.src.includes("/static/js/main."),
        )?.src,
      };
    });
    await pause.click();
    const years = result.boundaries.filter(({ year }) => year);
    expect(
      years.length,
      "sample must include a rendered January boundary",
    ).toBeGreaterThanOrEqual(1);
    expect(result.gaps.length).toBeGreaterThan(0);
    const displayMs = percentile(result.idleGaps, 0.5);
    const targetHz = desktop ? 120 : 60;
    const budgetMs = 1000 / targetHz;
    // Include the blocking work before a rendered boundary and the deferred work after it.
    const near = (gap: FrameGap, boundaries: Boundary[]) =>
      boundaries.some(
        ({ at }) => gap.at >= at - 100 && gap.at - gap.duration <= at + 250,
      );
    const report = {
      journey: journey.name,
      project: testInfo.project.name,
      targetHz,
      cpuThrottleRate: cpuRate,
      speed: desktop ? "24×" : "12×",
      budgetMs,
      budgetToleranceMs: 0.5,
      idleRefreshHz: displayMs ? 1000 / displayMs : 0,
      hostRefreshCanMeetTarget: displayMs <= budgetMs + 0.5,
      developmentInstruments: result.developmentInstruments,
      runtime: {
        url: page.url(),
        mainScript: result.mainScript,
        browserVersion: page.context().browser()?.version(),
        headless: testInfo.project.use.headless ?? true,
        platform: process.platform,
        arch: process.arch,
      },
      ordinary: summarize(
        result.gaps.filter((gap) => !near(gap, result.boundaries)),
        budgetMs,
        displayMs,
      ),
      month: summarize(
        result.gaps.filter((gap) => near(gap, result.boundaries)),
        budgetMs,
        displayMs,
      ),
      year: summarize(
        result.gaps.filter((gap) => near(gap, years)),
        budgetMs,
        displayMs,
      ),
      boundaries: result.boundaries.map((boundary) => ({
        ...boundary,
        worstNearbyGapMs: Math.max(
          0,
          ...result.gaps
            .filter((gap) => near(gap, [boundary]))
            .map(({ duration }) => duration),
        ),
      })),
      longTasks: result.longTasks,
      longTaskSupported: result.longTaskSupported,
      limits:
        "Animation-frame gaps measure callback scheduling, not physical presentation; missedDisplayFrames estimates skipped idle-cadence intervals. Local Chromium viewport emulation is not real phone or M5/ProMotion verification. CDP CPU slowdown is a page/main-thread proxy; it does not model worker/GPU speed, device thermals or battery limits. Timing values are reports, not CI gates; boundary windows include nearby rendering, forecasts and autosave.",
    };
    console.log(
      JSON.stringify({
        project: report.project,
        journey: report.journey,
        speed: report.speed,
        cpuThrottleRate: report.cpuThrottleRate,
        idleRefreshHz: report.idleRefreshHz,
        ordinary: report.ordinary,
        month: report.month,
        year: report.year,
        longTasks: {
          count: report.longTasks.length,
          worstMs: Math.max(
            0,
            ...report.longTasks.map(({ duration }) => duration),
          ),
        },
      }),
    ); // eslint-disable-line no-console
    const reportPath = testInfo.outputPath("frame-budget.json");
    const samplesPath = testInfo.outputPath("frame-samples.json");
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    fs.writeFileSync(samplesPath, JSON.stringify(result, null, 2));
    await testInfo.attach("frame-budget.json", {
      path: reportPath,
      contentType: "application/json",
    });
    await testInfo.attach("frame-samples.json", {
      path: samplesPath,
      contentType: "application/json",
    });
  });
}
