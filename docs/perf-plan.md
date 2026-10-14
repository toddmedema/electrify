# Performance plan

Performance goals, lab benchmarks, and the workflow to climb them. One developer, no live userbase:
every measurement is lab-based (benches, CI, local runs on the M5 MacBook, manual device checks). No
field telemetry, no staged rollouts.

The foundation measurements below describe the earlier implementation; the audit and current
status at the end of this document supersede completed roadmap items.

The initial revision corrected the first draft against the code. The changes that matter most:

- The headless sim calls `tickState` on a plain object (`src/testing/Simulator.tsx`); the browser
  runs it inside RTK's Immer draft. Headless-only numbers miss proxy and finalize cost, so every
  tick bench measures both paths.
- The biggest known rollover cost is in the UI, not the reducer. The twenty-year hourly projection
  that Insights and the top bar's cash-runway warning share (`selectProjection`, 5,760 steps) was
  rebuilt in `render` on every month change. `HydroWaterSection` (one year) and the intertie outlook
  (two years, hourly) are also keyed on the month. The reducer's own rollover forecast is 96 ticks.
  The `Forecasts` and `Finances` panes the first draft named have been removed.
- Weather is already memoized: `getWeather` reads a cached row array and extrapolates each day once.
  "Load weather up front" is not a lever.
- `TICK_MS` lives in `src/Constants.tsx` and the tick loop in `src/reducers/Game.tsx`, both inside
  the run-compatibility hash. Pacing changes affect the rules fingerprint. Compatible saves carry their run, challenge, replay
  and score forward through `carryRunForward`; keep reducer changes together and prove parity.
- Valgrind instruction counting is demoted to a timeboxed experiment. The repo already has a better
  pattern: `--benchmark-stories` gates on a ratio of two measurements in the same process, which
  cancels machine speed.
- Merge to master is a prod deploy, so no automated job may commit ratchet updates to master.

## Foundation measurements (historical)

From `npm run perf:bench` on the M5 (Node 24.14, median of three warmed runs):

| Reducer tick           | Plain object | Inside Immer |
| ---------------------- | -----------: | -----------: |
| Ordinary tick, median  |     0.017 ms |      0.50 ms |
| Month rollover, median |       8.4 ms |        37 ms |
| Month rollover, worst  |            — |        97 ms |

Screen forecasts, from the bench's UI section at month 60, re-measured when G3 thread 1 retargeted
it at the screens actually mounted (the reducer rollover median was 11 ms in that run):

| Screen forecast                                                         |   Cost |
| ----------------------------------------------------------------------- | -----: |
| Shared projection, twenty years (Insights, runway warning; month-keyed) | 145 ms |
| BuildGenerators three-year quote (catalog open)                         |  63 ms |
| Hydro outlook, one year (month-keyed)                                   |  20 ms |
| Intertie outlook, two years hourly (month-keyed)                        |  10 ms |

From `e2e/perf-census.spec.ts` against the dev server, 30 FAST steps of one presentation frame each:
desktop makes 60 React commits for 30 dispatches, and mobile-390px makes 80. Every tick batch
commits at least twice. That is worth explaining before optimizing commit cost. The census also
records real wall time per step: on mobile-390px, the step that crosses the month rollover took 372
ms (dev build), against about 20 ms for an ordinary step.

Three conclusions reorder the climb. Immer, not the simulation, is about 97% of an ordinary tick in
the browser. The reducer's rollover alone already exceeds a 16.7 ms frame, before any React work.
And the month-keyed screen forecasts cost several times the reducer's rollover.

## Goals

- **G1: 60 Hz on phones.** No frame over 16.7 ms during normal play at any speed, FAST included,
  with tick + commit cost around half the budget. CI proxy: deterministic commit and mutation counts
  on the mobile-390px project. Truth: manual play on a real phone with the dev readout.
- **G2: 120 Hz on the M5 MacBook.** No frame over 8.33 ms, with updates landing on ProMotion frames.
  Presentation now follows `requestAnimationFrame`. FAST (12x) uses `1000 / 60` ms steps; ULTRA
  (24x), offered at desktop widths, uses `1000 / 120` ms steps. `TickCadence.test.tsx` pins their
  jittered 60/120 Hz cadence and accumulated time. This proves scheduling, while actual frame
  deadlines still require measurements on the M5.
- **G3: No visible hiccup at month and year boundaries.** The rollover frame does two kinds of work.
  In the reducer: summarize the month, reprice credit, resolve world events and wildfire hazards,
  advance policies, regenerate the 96-tick timeline (deep-cloned fleet), and run four pre-roll
  finance passes. In the UI: month-keyed forecasts on the visible screen (the shared twenty-year
  projection: 5,760 hourly steps; hydro: 1,152 ticks; intertie: 2,304 hourly steps), plus a larger
  commit (new timeline array, new history row). Every fix keeps `monthlyHistory` identical (B2).

## Journeys

1. **Fresh load to first rendered tick** (bundle, data fetches, init).
2. **New game:** scenario pick to first in-game tick.
3. **Core loop:** time advancing while the player watches (most of play). Per presentation update:
   `tickState` under Immer, then React and uPlot work. G3 lives here.
4. **Building:** open the catalog, read quotes, confirm, return. `BuildGenerators` calls
   `generateNewTimeline` for three years, memoized per game state.
5. **Save resume:** load a save, resume.

## Benchmarks

Each benchmark has a lab metric an agent can move and, where it is stable enough, a CI gate.
Ceilings live in `scripts/perf/*-baselines.json`, outside the run-compatibility hash. Measurement
code lives in `src/testing/`, `scripts/perf/`, `e2e/`, and `src/index.tsx`. None of these are
hashed, so measuring never forces a manifest regeneration.

### B2: Golden output hashes (behavior preservation, first)

Determinism tests compare runs against each other. B2 pins absolute output: for every scenario at
its `sim --all` seed (authored, else 12345), hash `monthlyHistory` plus a final-state summary, and
store the hashes as a Jest snapshot. Numbers are rounded to 10 significant digits before hashing, so
V8 last-bit drift doesn't flake the gate while any real behavior change still does. Rounding can't
absorb drift that a run amplifies, though: V8 hands `Math.pow` and `**` to the C library's `pow`,
whose last bit differs between glibc and Windows' CRT, and 32 such bits sent scenario 108 down a
different path on Windows. Simulation code therefore calls `pow` from `src/helpers/Pow.ts` (a port
of glibc's, bit-identical to CI's Linux `Math.pow`), and lint rejects `Math.pow` and computed `**`
in `src/data`, `src/helpers` and `src/reducers`. The other Math functions are V8's own fdlibm port
and agree everywhere.
Rebaseline with `npm run perf:rebaseline` (Jest `-u` on that suite); CI's `--ci` mode never writes
snapshots, so a changed hash fails. The snapshot diff shows which scenarios moved, which also helps
review balance work. Regenerate last; never hand-edit.

### B1: Tick cost bench (headline lab metric)

`npm run perf:bench` runs through CRA's Jest the way `npm run sim` does. Workload: scenario 103 (The
Shale Boom), seed 12345, Employee, $0.035/kWh, 240 months (23,040 ticks), one financed 200 MWh
battery at month 36 so construction and finance paths run, and invariants off. The first draft's
month-0 800 MWh battery is impossible: batteries unlock in 2008 and this scenario starts in 2006,
while larger batteries bankrupt the run before it ends. The bench warns if a future economics change
ends the run early. It reports, as a median of warmed runs:

- ms/tick on the plain object (headless path) and inside Redux Toolkit's own Immer
  (`createNextState`, the browser path; `immer` resolves to react-scripts' older copy);
- the Immer overhead ratio between the two;
- total ms per simulated year.

Wall-clock numbers are reported, not gated. Two ratios are gated, because a ratio measured in one
process cancels machine speed (the `--benchmark-stories` pattern): the overall draft/plain tick
ratio and the paired draft/plain median rollover ratio from B7. Their ceilings sit in `scripts/perf/bench-baselines.json` with a
generous tolerance (25%). Measured spread: the typical rollover ratio stays within ±5% run to run
and the Immer ratio within about ±10%, so both can tighten once CI's spread is known. Runtime is
about 80 s.

Local profiling: `node --cpu-prof` through the same entry point.

**Valgrind experiment (timeboxed to one day, not blocking).** Run `callgrind` with
`node --predictable` on a Linux runner. Keep it only if two runs of the same commit agree within
0.5% and the job finishes under 10 minutes. The CRA-Jest host (Babel, jsdom, module registry) is the
likely failure point. Otherwise drop it.

### B7: Rollover cost (G3)

- **Headless (in `perf:bench`):** per-tick cost across the run on the Immer path. Report the median
  ordinary tick, the median and worst month rollover, and the worst January. The gate compares
  median draft rollover with median plain rollover in the same workload. The former
  rollover/ordinary ratio remains reported: gating it penalized improvements to ordinary ticks
  even when rollover time fell. The worst-rollover ratio is also reported, since a single
  maximum is sensitive to GC pauses.
- **UI forecasts (in `perf:bench`):** time the forecasts the mounted screens rebuild, each called
  exactly as the screen does: the shared twenty-year projection, the hydro outlook, and the intertie
  outlook (month-keyed, now computed after paint), plus the BuildGenerators three-year quote (catalog
  open). These are reported in ms and as multiples of the reducer rollover. Each is still one long
  task wherever it runs, so they remain the attribution for the rest of G3.
- **Browser:** `e2e/frame-budget.spec.ts` records real compositor frames at 12x on 390 px and
  24x on 1440 px, including rendered month and January boundaries and the surrounding forecast,
  story and autosave work. Its JSON attachments report ordinary/month/year gaps, missed display
  frames, long tasks and the host's idle cadence. No fake clock or development hook is needed.
  Point `E2E_BASE_URL` at an already-served production build and use `--workers=1` for timing
  evidence; otherwise the normal development server is used. Functional progress is asserted,
  while timings remain reports. A 60 Hz host cannot verify the 120 Hz target, and viewport
  emulation cannot verify a real phone.
- **Manual:** play through a boundary on a real phone with the dev overlay.

### B3/B4: React commit and DOM census per tick batch

- A dev-only module (`src/testing/PerfCensus.tsx`), installed from `src/index.tsx` only when
  `NODE_ENV !== "production"`, wraps the app in a React `<Profiler>`. It exposes commit counts,
  commit durations, a MutationObserver node-change count, and a dispatch count on `window.__perf`.
  No reducer or action changes.
- `e2e/perf-census.spec.ts` installs Playwright's clock, starts a game, and advances time **in
  frame-sized steps with a settle after each**. React 18 schedules commits through MessageChannel,
  which the fake clock does not control. A single `runFor(N)` would merge an unknown number of ticks
  into one commit, so the counts would not be deterministic. For N steps it reports commits,
  mutations, and dispatches on desktop and mobile-390px, with the month boundary measured separately
  from ordinary ticks. The spec also covers opening the build catalog.
- CDP `Performance.getMetrics` supplies the RecalcStyle and LayoutCount deltas.
- Runs against the dev server (StrictMode double renders): deterministic, but not production
  numbers. Commit ms are reported, never gated.
- Ordinary and month-boundary ticks commit once per dispatch. StrictMode double-renders but does
  not add commits. A react-redux `connect()` container defers every store reader below it to an
  extra commit (it notifies them from a layout effect), so game containers that map `state.game`
  use `connectToStore` (`src/components/base/ConnectToStore.tsx`) or hooks. The build catalog's
  extra commits come from MUI ripples, react-transition-group phases and Avatar image loads.
- Gate: counts ≤ ceilings in `scripts/perf/census-baselines.json`. Kept out of the PR smoke job
  until it has been stable across several CI runs; run locally with
  `npm run test:e2e -- perf-census.spec.ts --project=desktop-chromium`.

### B5: Bundle size

`scripts/perf/bundle-size.js` runs after `npm run build`. It measures the gzip bytes of the main JS
and CSS chunks and the total initial JS. The ceilings in `scripts/perf/bundle-baselines.json` allow
10% tolerance. This needs no browser, so CI runs it right after the production build. Load journey
timing (request count, bytes transferred, navigation to first tick) against the production build is
local-only until proven stable.

### B6: Frame budget readout

A dev-only overlay, enabled with `?perf=1` and remembered in `localStorage`. From rAF timestamps it
shows fps, the detected refresh rate, the worst frame gap in the last second, and the longest task
(PerformanceObserver `longtask` where supported). It provides the before/after evidence in PRs and
the truth for manual phone and ProMotion checks. It has no CI timing gate.

## Climbing the goals

The October audit below completes the planned rAF scheduling, plain working-state ticks, and
worker forecasts. The next climb needs measurements on the target hardware. Use the production
frame journey on an actual 60 Hz phone at 12x and a headed browser on the M5's active 120 Hz display
at 24x. Record ordinary frames, all month transitions, January, and a developed save separately.

On the lab host, chart text/axes painting remains a substantial desktop cost. Profile the whole
presentation, including React, workers' replies and saves, before changing chart behavior. The
shared projection's decoder yields between rows against a 3 ms deadline; one row and final assembly
can overshoot that deadline, so it is a slicing budget rather than a guaranteed task maximum.

## Workflow

- **Threads are issues.** One GitHub issue per benchmark or hotspot, labeled `perf`, naming its
  metric and target, with findings and numbers in the issue. Cap: five open.
- **Per thread:** baseline, profile (`perf:bench`, `--cpu-prof`, census), optimize within scope,
  then prove the metric dropped, B2 held, and `npm run check` is green. Open a PR with before/after
  numbers, plus screenshots via `gh pr create --attach` for visible changes. Todd approves every PR.
- **Periodic local run (not a cron on master).** `scripts/perf/` benches run on the M5 on demand or
  from a local schedule. They report numbers and suggest ceiling reductions as a patch or PR, never
  a direct commit to master, since master is prod. No bot files issues.
- **Ratchet updates are explicit.** `npm run perf:rebaseline` rewrites B2 snapshots and bench
  ceilings in one visible diff. Ceilings only move down, except for a PR that legitimately adds work
  and says so.
- Dropped from the first draft: a `perf-results` workflow on every master push (it duplicates PR CI
  and would race the deploy for little signal), flag-cleanup sprints (perf changes must be
  behavior-preserving by B2, and hashed code can't read non-hashed flags without being hashed
  itself), and a separate `perf-brief.md` (this file is the brief).

## Guardrails

- **Tests before optimizations.** B2 plus the invariant suite run on every PR. A perf PR that
  changes behavior fails loudly.
- **Manifest.** Perf work that touches `src/data`, `src/helpers`, `src/reducers`,
  `src/Constants.tsx`, or `src/Types.tsx` changes the generated (git-ignored) `RunCompatibility.json`
  hash. Preserve the compatible-run carry-forward path and prove that simulation outputs stay
  identical; do not commit the generated manifest.
- **Determinism.** Seeded paths use only the `src/helpers/Math.tsx` seed helpers.
- **No flaky ms gates.** CI gates only counts, bytes, hashes, and same-process ratios.
- Visual regression is out of scope.

## Sequence

- **Done: foundation PR.** B2 golden snapshots and `perf:rebaseline`, the `perf:bench` harness
  (B1, headless B7 and UI forecasts, with ratio ceilings), B5 bundle size in CI, the B3/B4 census
  module, spec, and ceilings, the B6 overlay, and this plan.
- **Done: G3 thread 1** (UI-only, no manifest). Month-keyed forecasts are computed after paint
  (`components/base/AfterPaint`), with the previous value kept on screen. Insights and the runway
  warning share one deferred twenty-year projection (`DeferredProjection`). Ticks commit once per
  dispatch (`connectToStore`). The BuildGenerators quote is memoized per game state. Measured
  with a `longtask` PerformanceObserver during the census run (dev build), the rollover frame's
  longest task drops from about 110–120 ms to under 50 ms; the projection still runs as an 85 ms
  task one frame later. The census's `maxStepMs` includes both, because the fake clock runs the
  deferred work inside the same step.
- **Done: G3 worker refreshes.** `DeferredProjection` now keeps a persistent worker for the
  shared twenty-year forecast. It sends the exact snapshot that invalidated the forecast, adopts
  the result into the shared projection cache, and rejects results superseded by a month change,
  player decision, or imported run. One request can be in flight; rapid edits collapse to the
  newest pending snapshot. The last subscriber leaving terminates the worker. Worker startup or
  data-loading failures fall back to the existing after-paint computation. An expired immediate
  mission warning clears while the worker computes its replacement, instead of synchronously
  rebuilding the runway forecast on that transition.
  The worker retains initialized data between requests: weather reloads only when the city or
  watershed changes; a new seed resets all three datasets' seeded forecast caches. Failed
  initializations remain retryable, with all loads settled before the next request begins.
  - Windows / Node 24.14, desktop Chromium dev build, scenario 103, fixed seed: two alternating
    comparisons of the after-paint fallback and worker, each with 2.1 seconds of warmup and 6.5
    seconds at FAST, advanced from month 1 through month 5. The worst animation-frame gap fell
    from **350–367 ms to 83–100 ms**. Worst observed long task fell from **342–360 ms to 75–78 ms**;
    total long-task time fell from **1,598–1,682 ms to 269–285 ms**. These are local measurements,
    not timing gates or production-device guarantees.
  - `e2e/projection-worker.spec.ts` verifies on desktop and 390 px mobile that real workers
    successfully return multiple month forecasts, without falling back, while animation frames
    continue. Unit tests cover coalescing edits, rejecting stale results, cache adoption,
    cleanup, and the error fallback.
  - Limits at the time of that change (addressed by the October audit below): the first projection
    on mount was synchronous, as was the recovery when
    Insights has no suitable previous forecast. The reducer rollover, hydro and intertie
    outlooks, worker-message cloning, and chart commits still use the main thread. The local
    reducer benchmark measured a 34.51 ms median and 44.48 ms worst rollover; this change does
    not claim to meet the 16.7 ms budget yet. Precomputing the reducer's next month would require
    invalidating its exact state and side effects; it is unnecessary for isolating this larger,
    pure UI forecast and was deliberately not introduced here.
- **Done: October frame audit.** Plain working-state ticks, forecast startup and outlook workers,
  transferable projection replies, stable leaf rendering and production frame evidence are
  documented below. Existing rAF scheduling and the 12x/24x speed constants remain unchanged.
- **Timeboxed spike:** Valgrind feasibility, kept only if it passes its criteria.

## Open questions

- Scheduling and 12x/24x cadence are implemented; the remaining evidence is actual phone/M5
  production play at the target refresh rate, including both sparse and developed fleets.
- Worker failures retain the after-paint main-thread fallback, which preserves functionality
  but cannot promise the same frame budget as successful worker computation.
- Tolerances for the B1/B7 ratio ceilings: they start at 25% and tighten once CI spread is known.
  The current ceilings are recorded on win32-x64; confirm their spread on the Linux x64 CI runner
  before changing the tolerance.

## October 2026 frame audit

This audit compares the unchanged production build at the master merge of PR #528 with the
optimized build. Lab host: Windows x64, Node 24.14.0, Chromium 151, headless, observed idle cadence
59.88 Hz. Desktop uses 1440 px at 24x; phone uses 390 px at 12x. Viewport emulation and the page's
4x CDP CPU slowdown are proxies: they do not reproduce a physical phone, worker/GPU speed,
thermals or battery constraints. This host cannot establish the M5's 8.33 ms frame deadline.

### Changes and behavior preservation

- Live reducer batches create one plain working state from the untouched Immer draft, isolate
  each settled timeline frame and mutable fleet fields, and adopt once. Month inputs are copied
  only at rollover. Unchanged history/events retain their references; replay actions retain the
  original draft path. Reusing resolved story effects removes repeated price/fee lookups.
- The initial shared projection and month-keyed hydro/intertie outlooks run in persistent workers.
  Results are scoped to the exact run and request; stale/imported results are rejected, rapid
  requests coalesce, data loads remain retryable, and failures retain the after-paint fallback.
- Projection replies transfer numeric buffers instead of deserializing thousands of rich tick
  objects in one message task. Decoding yields between rows against a 3 ms deadline and preserves
  values, optional-field presence, deferred-load queues and aliases. History comes from the
  pending snapshot. Cancellation also covers a reply that is still being decoded.
- Insights keeps a suitable forecast while refreshing, shows a loading label on first mount,
  separates the live exchange summary from the chart, and avoids persisting a redundant automatic
  viewport shift. Stable facility/hydro statistic leaves skip unchanged renders. The frame overlay
  retains long stalls rather than discarding gaps over one second.

Full-state parity covers every scenario and standard CEO balance playbooks through the real draft
wrapper. Focused tests cover real multi-step presentation batches across normal/month/January
boundaries, pause and replay, exact worker transport, cancellation, failures and visible forecast
publication. Golden outputs did not change. No simulation constants, economics, authored data or
seeded outcomes changed.

### Reducer and size evidence

The same 240-month bench workload (scenario 103, seed 12345, three warmed runs, financed battery at
month 36) ran without concurrent browser/build/check work. These are local costs, not device
frame guarantees; a browser dispatch can settle several simulation steps and also render/save.

| Draft tick metric              |     Before |      After |
| ------------------------------ | ---------: | ---------: |
| Ordinary median                |  0.2065 ms |  0.0384 ms |
| Month median                   | 14.5563 ms |  6.3483 ms |
| Worst month                    | 22.7706 ms | 10.9907 ms |
| Worst January                  | 18.0013 ms |  9.6746 ms |
| Whole-run draft/plain ratio    |      4.113 |      1.352 |
| Paired draft/plain month ratio |      2.240 |      1.062 |

The month median fell 56%; ordinary ticks fell 81%. The final independent benchmark passes the
new ceilings. The shared forecast still costs about 440 ms in the Jest bench when invoked
synchronously, which explains why scheduling it off the presentation thread matters.

Rebaselining was performed last with the golden snapshot unchanged. The old month/ordinary gate
penalized a faster ordinary tick even when month time fell, so it is replaced by paired draft/plain
month medians. The unchanged-build paired ratio was 2.240 (a 2.800 ceiling with 25% tolerance).
The rebaseline tightens that ceiling to 1.315 and the whole-run draft/plain ceiling from 5.022
to 1.632. Both are overhead gates: a shared algorithm slowdown can escape the ratio, so absolute
browser and bench evidence remains necessary. The golden-suite selector now also works in a
Windows managed worktree.

Production gzip: main JS 882.69 -> 884.47 kB; all JS 1388.28 -> 1394.20 kB; CSS 23.36 kB unchanged.
The existing bundle ceilings and browser census ceilings are preserved. The final desktop and
phone census pass, with one commit per dispatch during ordinary play and six commits across six
dispatches in the rollover window.

### Browser frame evidence

One sequential sample per journey/build, with the same seeded new game, production data and normal
local saves. Each observes at least twelve rendered month boundaries including January, plus a
350 ms tail. Month/year windows include the 100 ms before and 250 ms after a rendered boundary;
January is a subset of month windows. Ordinary samples contain everything else, including late
worker replies. Callback gaps are measured, while skipped idle-cadence intervals are estimated.
The report uses a 0.5 ms budget tolerance to accommodate timestamp/cadence jitter.

Triples below are **ordinary / month / January worst callback gaps, in ms**. All final native
samples have zero long tasks. Desktop main also mounts Insights, so its duplicate is omitted.

| Native journey               |              Before |              After | Estimated skipped intervals before -> after (ordinary / month / January) |
| ---------------------------- | ------------------: | -----------------: | -----------------------------------------------------------------------: |
| Phone 12x main panes         |  16.8 / 16.8 / 16.8 | 16.8 / 16.8 / 16.8 |                                                   0 / 0 / 0 -> 0 / 0 / 0 |
| Phone 12x Insights           |  16.8 / 33.3 / 16.7 | 16.8 / 16.8 / 16.8 |                                                   0 / 1 / 0 -> 0 / 0 / 0 |
| Desktop 24x main panes       |  16.8 / 33.4 / 33.4 | 16.8 / 16.8 / 16.8 |                                                   0 / 2 / 1 -> 0 / 0 / 0 |
| Phone 12x hydro outlook      |  16.8 / 66.7 / 50.0 | 16.8 / 16.8 / 16.7 |                                                  0 / 21 / 2 -> 0 / 0 / 0 |
| Desktop 24x hydro outlook    | 50.0 / 100.0 / 83.3 | 33.4 / 33.4 / 33.3 |                                               31 / 69 / 6 -> 20 / 31 / 3 |
| Phone 12x intertie outlook   |  16.8 / 16.8 / 16.8 | 16.8 / 16.8 / 16.7 |                                                   0 / 0 / 0 -> 0 / 0 / 0 |
| Desktop 24x intertie outlook |  33.4 / 50.0 / 50.0 | 33.4 / 33.3 / 16.8 |                                                  9 / 28 / 3 -> 2 / 1 / 0 |

All four native phone-layout runs hold the lab's 60 Hz callback cadence. Desktop Hydro still skips
idle-cadence intervals despite removing its long tasks; this is an improvement, not stutter-free
or 120 Hz evidence. The host's 16.7 ms cadence already exceeds the 8.33 ms desktop target.

The page/main-thread 4x slowdown still misses the smoothness goal:

| Phone 12x, CPU 4x |     Worst gaps before |     Worst gaps after | Long tasks before -> after | Worst long task before -> after |
| ----------------- | --------------------: | -------------------: | -------------------------: | ------------------------------: |
| Insights          | 116.7 / 133.2 / 116.7 |   83.3 / 83.3 / 83.2 |                   24 -> 12 |                    127 -> 95 ms |
| hydro outlook     | 166.7 / 483.3 / 333.4 | 116.6 / 200.0 / 66.7 |                   87 -> 48 |                   400 -> 149 ms |

Hydro's January worst falls from 333.4 to 66.7 ms, but its ordinary skipped-interval estimate rises
from 435 to 482; month windows fall from 375 to 179 and January from 29 to 12. The proxy remains
unsmooth and is not uniformly improved. Profiles before the final catch-up/transport fixes identify
chart axis/text painting and React presentation as substantial costs. The daily chart intentionally
repaints its moving Now marker and history/forecast boundary; its options and uPlot instance are
already reused. Save serialization was small in the first-year profile;
the developed-save comparison below checks a longer history separately. Profiled runs add overhead
and are used for attribution only, not the timing table.

### Developed-save evidence

A genuine reducer playthrough, not synthetic appended history: scenario 103, CEO, seed 1,
`STANDARD_BALANCE_PLAYS[103]` plus the `keepUp` strategy through 227 months. The December 2024 save
contains five operating gas plants, 13 actions, $617M cash, 227 monthly records and no invariant
violations, bankruptcy or firing. Its encoded JSON is 328,122 bytes. Both production builds load
the identical fixture through the normal saved-game slot/Continue path with matching difficulty.
This lab fixture stays out of the repository's generated artifacts.

Both modes observe eleven transitions through November 2025, including January 2025, and the same
350 ms tail. The shorter window leaves headroom before the authored month-240 scenario ending.
Triples retain the ordinary / month / January ordering. All four matched runs have zero long tasks.

| Developed save, native CPU |  Worst gaps before |   Worst gaps after | Estimated skipped intervals before -> after |
| -------------------------- | -----------------: | -----------------: | ------------------------------------------: |
| Desktop 24x                | 33.4 / 50.0 / 33.3 | 33.4 / 33.3 / 33.3 |                    11 / 10 / 1 -> 4 / 1 / 1 |
| Phone 12x                  | 16.8 / 16.8 / 16.8 | 16.8 / 16.8 / 16.8 |                      0 / 0 / 0 -> 0 / 0 / 0 |

The phone layout holds lab cadence with the longer history on both builds. Desktop month stalls
improve, while isolated 33 ms gaps remain. This checks history/autosave growth separately from the
Hydro/intertie scenes; a five-plant gas fleet does not cover every possible late-game fleet.

**Goal status:** the native phone-layout proxy holds 60 Hz cadence, but a physical phone still
needs verification. The 120 Hz M5 goal is unverified on this 60 Hz host. The no-stutter goal remains
unmet in desktop Hydro and the CPU4 proxy, even though the worst rollover stalls are much smaller.
For the next device check, serve a production build, set `E2E_BASE_URL`, and run the frame spec with
`--project=desktop-1440px --workers=1 --headed` on the M5's active 120 Hz display. Repeat the same
scenes on the target phone with browser performance recording. The dev-only overlay helps
attribution; viewport emulation remains a separate lab proxy.

### Validation

Node 24 and exact-lockfile install; full `npm run check` (types including e2e, lint, formatting,
covered Jest tests, all simulation suites and CLI); `npm run sim -- --all` (all invariants hold);
CI production build; independent final `perf:bench` and `perf:bundle`; unchanged
goldens through `perf:rebaseline`; desktop/phone census; 18 production browser functional tests
for worker publication, build options and tutorial exit. The final code-review agent completed
three feedback rounds with no remaining actionable findings; its refresh-test proof issue was
corrected by holding
the second worker reply until the viewport settles, then requiring publication to change the UI.

The October 14 achievement bundle audit found the initial web JavaScript at 885.68 kB,
just beyond the existing 10% tolerance. Compile-time guards now omit Electron telemetry
migration and resets, and the optional Firebase Analytics SDK loads with its first online
event. Production gzip drops to 882.48 kB initial JS and 1393.04 kB all JS (from 1395.50 kB).
The bundle ceilings remain unchanged. Tests cover deferred event ordering, connection loss
during loading, offline initialization, retry after chunk/SDK failures and cross-edition saves.
