// B3/B4 census (docs/perf-plan.md): React commits, DOM mutations, store dispatches, and style
// and layout counts per batch of FAST ticks, gated against ceilings in
// scripts/perf/census-baselines.json. Rebaseline with PERF_UPDATE=1.
//
// Counts are deterministic because virtual time only moves in frame-sized steps and every step
// settles before the next: React 18 commits and runs effects through MessageChannel, which
// Playwright's clock does not control, so one long runFor would merge an unknown number of
// ticks into each commit.
//
// Durations: the Profiler's commit times read the faked (frozen) performance.now, so they are
// always zero here. Instead each window reports stepMs, the real main-thread wall time from
// before runFor to the end of settling (ticks, renders, commits, effects and forced layout),
// read from a performance.now captured before the clock was installed. Reported, never asserted.
import { CDPSession, expect, Page, test, TestInfo } from "@playwright/test";
import fs from "fs";
import path from "path";
import { openPane } from "./layout";

const BASELINES = path.join(
  __dirname,
  "..",
  "scripts",
  "perf",
  "census-baselines.json",
);
const STEP_MS = 17;
const WARMUP_STEPS = 60;
const ORDINARY_STEPS = 30;
// Steps either side of the step whose ticks cross into a new month
const ROLLOVER_BEFORE = 2;
const ROLLOVER_AFTER = 3;
// One month is ~960 virtual ms at FAST; allow two
const MAX_STEPS_TO_ROLLOVER = 120;
const CATALOG_STEPS = 40;
// performance.now() at which every run starts measuring; see the pause below
const CLOCK_ORIGIN_MS = 3_600_000;

// Counters gated against ceilings. They are identical run to run.
const GATED = [
  "commits",
  "dispatches",
  "mutationRecords",
  "addedNodes",
  "removedNodes",
  "attributeMutations",
  "textMutations",
] as const;
// Reported only. Style recalcs and layouts also happen in real rendering frames, which run on
// the host's wall clock rather than the fake one, so they vary by roughly 10% between runs.
const REPORTED = ["recalcStyleCount", "layoutCount"] as const;
type Gated = (typeof GATED)[number];
type Counts = Record<Gated | (typeof REPORTED)[number], number> & {
  stepMs: number;
  maxStepMs: number;
};
type Census = Record<string, Counts>;

interface Snapshot {
  commits: number;
  dispatches: number;
  mutationRecords: number;
  addedNodes: number;
  removedNodes: number;
  attributeMutations: number;
  textMutations: number;
  game?: { minute: number; monthsElapsed: number; speed: string };
}
declare global {
  interface Window {
    __perf?: { reset: () => void; snapshot: () => Snapshot };
    __perfRealNow?: () => number;
    __perfStepStart?: number;
  }
}
type Sample = Snapshot & {
  recalcStyleCount: number;
  layoutCount: number;
  // Real ms for the step that produced this sample, 0 for samples taken outside a step
  stepMs: number;
};

/**
 * Drain React work the fake clock cannot see. Each round waits one MessageChannel turn (React's
 * scheduler channel), then compares counters; two quiet rounds in a row mean React committed
 * everything it scheduled. Forcing layout last makes each step own exactly the layout it
 * caused instead of leaving it to whichever real frame happens next.
 */
async function settle(page: Page): Promise<Snapshot & { stepMs: number }> {
  return page.evaluate(async () => {
    const perf = window.__perf!;
    const turn = () =>
      new Promise<void>((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => resolve();
        channel.port2.postMessage(0);
      });
    let last = "";
    let quiet = 0;
    for (let round = 0; round < 100 && quiet < 2; round++) {
      await turn();
      const s = perf.snapshot();
      const key = `${s.commits}:${s.mutationRecords}:${s.dispatches}`;
      quiet = key === last ? quiet + 1 : 0;
      last = key;
    }
    void document.body.offsetHeight;
    const stepMs =
      window.__perfStepStart === undefined
        ? 0
        : window.__perfRealNow!() - window.__perfStepStart;
    window.__perfStepStart = undefined;
    return { ...perf.snapshot(), stepMs };
  });
}

async function metrics(cdp: CDPSession) {
  const { metrics } = await cdp.send("Performance.getMetrics");
  const value = (name: string) =>
    metrics.find((m) => m.name === name)?.value ?? 0;
  return {
    recalcStyleCount: value("RecalcStyleCount"),
    layoutCount: value("LayoutCount"),
  };
}

async function sample(page: Page, cdp: CDPSession): Promise<Sample> {
  const snapshot = await settle(page);
  return { ...snapshot, ...(await metrics(cdp)) };
}

async function step(page: Page, cdp: CDPSession): Promise<Sample> {
  await page.evaluate(() => {
    window.__perfStepStart = window.__perfRealNow!();
  });
  await page.clock.runFor(STEP_MS);
  return sample(page, cdp);
}

async function reset(page: Page, cdp: CDPSession): Promise<Sample> {
  await settle(page);
  await page.evaluate(() => window.__perf!.reset());
  return sample(page, cdp);
}

// Counters are cumulative since the last reset; step times belong to each sample
function windowCounts(samples: Sample[]): Counts {
  const from = samples[0];
  const to = samples[samples.length - 1];
  const steps = samples.slice(1).map((s) => s.stepMs);
  const counts = {
    stepMs: steps.reduce((sum, ms) => sum + ms, 0),
    maxStepMs: Math.max(0, ...steps),
  } as Counts;
  for (const key of [...GATED, ...REPORTED]) {
    counts[key] = to[key] - from[key];
  }
  return counts;
}

function readBaselines(): Record<
  string,
  Record<string, Record<Gated, number>>
> {
  try {
    return JSON.parse(fs.readFileSync(BASELINES, "utf8"));
  } catch {
    return {};
  }
}

// Projects run in parallel workers, so merge under an exclusive lock file
function writeBaseline(project: string, census: Census) {
  const lock = `${BASELINES}.lock`;
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      fs.closeSync(fs.openSync(lock, "wx"));
      break;
    } catch (error) {
      if (Date.now() > deadline) {
        throw error;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  try {
    const all = readBaselines();
    all[project] = Object.fromEntries(
      Object.entries(census).map(([window, counts]) => [
        window,
        Object.fromEntries(GATED.map((key) => [key, counts[key]])) as Record<
          Gated,
          number
        >,
      ]),
    );
    const sorted = Object.fromEntries(
      Object.keys(all)
        .sort()
        .map((key) => [key, all[key]]),
    );
    fs.writeFileSync(BASELINES, `${JSON.stringify(sorted, null, 2)}\n`);
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

async function report(testInfo: TestInfo, census: Census) {
  const lines = Object.entries(census).map(
    ([window, c]) =>
      `${testInfo.project.name} ${window}: ${[...GATED, ...REPORTED].map((k) => `${k}=${c[k]}`).join(" ")} stepMs=${c.stepMs.toFixed(1)} maxStepMs=${c.maxStepMs.toFixed(1)}`,
  );
  console.log(lines.join("\n")); // eslint-disable-line no-console
  await testInfo.attach("census.json", {
    body: JSON.stringify(census, null, 2),
    contentType: "application/json",
  });
}

test("B3/B4 commit, mutation and dispatch census at FAST", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("audioEnabled", "false");
    localStorage.setItem("theme", "light");
    // Registered before clock.install, so this runs first and keeps the real clock
    window.__perfRealNow = performance.now.bind(performance);
    // A new game mints its seed from Math.random, and the seed moves the multi-year forecasts
    // the rollover redraws. Other code draws a varying number of values before that, so restart
    // a fixed sequence (mulberry32) at every click, ahead of React's handlers.
    let seed = 0;
    Math.random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    document.addEventListener("click", () => (seed = 0x5eed), true);
  });
  // Installed before navigation so every app timer is fake; time flows until pauseAt
  await page.clock.install();
  await page.goto("/?scenario=103");
  await page.getByRole("button", { name: "Start game", exact: true }).click();
  const appbar = page.locator("#appbar:visible").first();
  const fast = appbar.getByRole("button", { name: "fast speed", exact: true });
  const pause = appbar.getByRole("button", { name: "pause", exact: true });
  await expect(pause).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__perf)))
    .toBe(true);

  // Freeze time, then jump to the same performance.now() in every run. The tick loop
  // accumulates fractional 16.67 ms timer gaps against 10 ms steps and hits exact ties every
  // third timer; whether floating-point rounding lands a tie on one side or the other depends on
  // the magnitude of the clock value, so a varying start shifts ticks between steps. The jump
  // also fires every start-of-game timer before measuring.
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 1_000);
  const paused = await page.evaluate(() => ({
    ticks: performance.now(),
    time: Date.now(),
  }));
  expect(paused.ticks).toBeLessThan(CLOCK_ORIGIN_MS);
  await page.clock.pauseAt(paused.time + (CLOCK_ORIGIN_MS - paused.ticks));
  expect(await page.evaluate(() => performance.now())).toBe(CLOCK_ORIGIN_MS);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  await settle(page);
  const start = (await page.evaluate(() => window.__perf!.snapshot())).game!;
  expect(start.speed).toBe("PAUSED");

  const census: Census = {};

  await fast.click();
  for (let i = 0; i < WARMUP_STEPS; i++) {
    await step(page, cdp);
  }

  // Ordinary ticks: no month boundary inside the window
  const ordinary: Sample[] = [await reset(page, cdp)];
  for (let i = 0; i < ORDINARY_STEPS; i++) {
    ordinary.push(await step(page, cdp));
  }
  const [first, last] = [ordinary[0], ordinary[ORDINARY_STEPS]];
  expect(
    last.game!.monthsElapsed,
    "the ordinary window must not cross a month boundary",
  ).toBe(first.game!.monthsElapsed);
  census.ordinary = windowCounts(ordinary);
  const ordinaryMinutes = last.game!.minute - first.game!.minute;

  // Month rollover: record per-step samples, then take the window around the crossing step
  const samples: Sample[] = [await reset(page, cdp)];
  const month = samples[0].game!.monthsElapsed;
  let crossing = -1;
  for (let i = 0; i < MAX_STEPS_TO_ROLLOVER; i++) {
    samples.push(await step(page, cdp));
    if (crossing < 0 && samples[i + 1].game!.monthsElapsed !== month) {
      crossing = i + 1;
    }
    if (crossing >= 0 && samples.length > crossing + ROLLOVER_AFTER) {
      break;
    }
  }
  expect(crossing, "FAST should reach a month boundary").toBeGreaterThan(
    ROLLOVER_BEFORE,
  );
  census.rollover = windowCounts(
    samples.slice(crossing - ROLLOVER_BEFORE - 1, crossing + ROLLOVER_AFTER),
  );

  // Build catalog: open it once to load its code, then census a second, warm opening
  await pause.click();
  await settle(page);
  const facilities = page.locator(".facilities");
  await openPane(
    facilities,
    page.getByRole("button", { name: "Facilities", exact: true }),
  );
  const build = page.locator(".button-buildFacility:visible").first();
  const catalog = page.getByRole("tab", { name: "Generators", exact: true });
  const openCatalog = async (samples: Sample[] = []) => {
    await build.click();
    await expect(catalog).toBeVisible();
    for (let i = 0; i < CATALOG_STEPS; i++) {
      samples.push(await step(page, cdp));
    }
    return samples;
  };
  const closeCatalog = async () => {
    await page.locator("#close-button").click();
    for (let i = 0; i < CATALOG_STEPS; i++) {
      await step(page, cdp);
    }
    await expect(build).toBeVisible();
  };
  await openCatalog();
  await closeCatalog();
  census.catalog = windowCounts(await openCatalog([await reset(page, cdp)]));

  await report(testInfo, census);
  await testInfo.attach("context.json", {
    body: JSON.stringify(
      { start, ordinaryMinutes, rolloverStep: crossing },
      null,
      2,
    ),
    contentType: "application/json",
  });

  const project = testInfo.project.name;
  if (process.env.PERF_UPDATE === "1") {
    writeBaseline(project, census);
    return;
  }
  const ceilings = readBaselines()[project];
  expect(
    ceilings,
    `no census ceilings for ${project}; run with PERF_UPDATE=1`,
  ).toBeDefined();
  for (const [window, counts] of Object.entries(census)) {
    for (const key of GATED) {
      expect
        .soft(counts[key], `${window} ${key} ceiling`)
        .toBeLessThanOrEqual(ceilings[window][key]);
    }
  }
});
