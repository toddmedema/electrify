# Performance plan

Performance goals, lab benchmarks, and the workflow to climb them. One developer, no live userbase:
every measurement is lab-based (benches, CI, local runs on the M5 MacBook, manual device checks). No
field telemetry, no staged rollouts.

This revision corrects the first draft against the code. The changes that matter most:

- The headless sim calls `tickState` on a plain object (`src/testing/Simulator.tsx`); the browser
  runs it inside RTK's Immer draft. Headless-only numbers miss proxy and finalize cost, so every
  tick bench measures both paths.
- The biggest known rollover cost is in the UI, not the reducer. The twenty-year hourly projection
  that Insights and the top bar's cash-runway warning share (`selectProjection`, 5,760 steps) was
  rebuilt in `render` on every month change. `HydroWaterSection` (one year) and the intertie outlook
  (two years, hourly) are also keyed on the month. The reducer's own rollover forecast is 96 ticks.
  The `Forecasts` and `Finances` panes the first draft named are no longer mounted.
- Weather is already memoized: `getWeather` reads a cached row array and extrapolates each day once.
  "Load weather up front" is not a lever.
- `TICK_MS` lives in `src/Constants.tsx` and the tick loop in `src/reducers/Game.tsx`, both inside
  the run-compatibility hash. Pacing changes are not free: every regenerated manifest invalidates
  outstanding challenge links. Batch reducer-touching perf work into as few releases as practical.
- Valgrind instruction counting is demoted to a timeboxed experiment. The repo already has a better
  pattern: `--benchmark-stories` gates on a ratio of two measurements in the same process, which
  cancels machine speed.
- Merge to master is a prod deploy, so no automated job may commit ratchet updates to master.

## First measurements

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
  Today the loop reschedules through `setTimeout(max(TICK_MS, 1000 / 60))` (`MAX_PRESENTATION_FPS`
  in `Game.tsx`), which caps presentation at 60 Hz regardless of display. At 120 Hz, FAST's 10 ms
  step yields 0.83 ticks per frame, so some frames get none (beat judder).
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
libm or V8 last-bit drift doesn't flake the gate while any real behavior change still does.
Rebaseline with `npm run perf:rebaseline` (Jest `-u` on that suite); CI's `--ci` mode never writes
snapshots, so a changed hash fails. The snapshot diff shows which scenarios moved, which also helps
review balance work. Regenerate last, alongside `compatibility:generate`; never hand-edit.

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
process cancels machine speed (the `--benchmark-stories` pattern): the Immer overhead ratio, and the
typical rollover ratio from B7. Their ceilings sit in `scripts/perf/bench-baselines.json` with a
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
  ordinary tick, the median and worst month rollover, and the worst January. The gate is the typical
  rollover ratio (median rollover ÷ median ordinary tick). The worst-rollover ratio is only
  reported: it is a single maximum that a GC pause can double, and it ranged 116–355 across runs.
- **UI forecasts (in `perf:bench`):** time the forecasts the mounted screens rebuild, each called
  exactly as the screen does: the shared twenty-year projection, the hydro outlook, and the intertie
  outlook (month-keyed, now computed after paint), plus the BuildGenerators three-year quote (catalog
  open). These are reported in ms and as multiples of the reducer rollover. Each is still one long
  task wherever it runs, so they remain the attribution for the rest of G3.
- **Browser:** at FAST under Playwright's clock, record the longest rAF gap spanning each month
  boundary. Local only at first.
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
1% tolerance. This needs no browser, so CI runs it right after the production build. Load journey
timing (request count, bytes transferred, navigation to first tick) against the production build is
local-only until proven stable.

### B6: Frame budget readout

A dev-only overlay, enabled with `?perf=1` and remembered in `localStorage`. From rAF timestamps it
shows fps, the detected refresh rate, the worst frame gap in the last second, and the longest task
(PerformanceObserver `longtask` where supported). It provides the before/after evidence in PRs and
the truth for manual phone and ProMotion checks. It has no CI timing gate.

## Climbing the goals

Every change lands with B2 unchanged, or rebaselined with a PR note that explains the move. The
order is G3 first, then G2, then G1.

**G3: kill the rollover hiccup.** Attribute with B7. The likely order:

1. **Take UI forecasts off the rollover frame (done, see Sequence).** Month-keyed screen forecasts
   now run after paint while the previous month's stay on screen.
2. **Shrink reducer rollover work:** the deep clone, per-tick object churn, and the four pre-roll
   passes. These are hashed inputs, so batch them into one release and prove B2 holds.
3. **Shrink the rollover commit:** stable references and memoized chart props, measured with the
   B3/B4 month-boundary numbers.
4. **Move the shared projection to a worker.** No longer an escalation: after step 1 it is still a
   single long task of about 85 ms in the frame after the rollover, which drops that frame. Screen
   forecasts are pure functions of state, so this is safer than moving the reducer's own rollover.

**G2: 120 Hz.**

- (a) Drive presentation from rAF instead of `setTimeout(1000 / 60)`. The accumulator already makes
  the simulation independent of dispatch cadence, so scheduling from rAF changes pacing only.
  Measure the refresh rate while playing, never at load, because ProMotion idles low. This touches
  `Game.tsx`, so it ships in a release that already regenerates the manifest.
- The accumulator compares floats. When a 16.67 ms timer lands exactly on a multiple of the 10 ms
  FAST step, rounding decides whether that tick runs in this frame or the next, and the result
  depends on how long the page has been open. It is harmless today, but the rAF loop should
  accumulate in integer microseconds or add an epsilon. The census spec pins the clock origin to
  stay deterministic.
- (b) Decide on `TICK_MS.FAST`. Changing it to 25/3 ms makes FAST 20% faster in real time and
  touches a hashed constant. The alternative is to interpolate the clock and chart viewport.
- (c) Climb B1 at the 8.33 ms budget.

**G1: 60 Hz on phones.** The same climbs at 16.7 ms, verified by manual play on a real phone.
Rollover frames and chart-heavy screens are the likely offenders. The largest per-tick lever is the
Immer tax: an ordinary tick costs 0.5 ms in a draft against 17 µs on a plain object. Candidates
include running `tickState` on a plain working copy of the hot subtrees and assigning the results
back once per batch, and keeping `timeline` from being proxied and frozen on every tick. This
touches `Game.tsx`, so it ships in the batched manifest release, and B2 must hold.

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
  `src/Constants.tsx`, or `src/Types.tsx` regenerates `RunCompatibility.json` last. That invalidates
  live challenge links, so batch such changes.
- **Determinism.** Seeded paths use only the `src/helpers/Math.tsx` seed helpers.
- **No flaky ms gates.** CI gates only counts, bytes, hashes, and same-process ratios.
- Visual regression is out of scope.

## Sequence

- **Foundation PR (this one).** B2 golden snapshots and `perf:rebaseline`, the `perf:bench` harness
  (B1, headless B7 and UI forecasts, with ratio ceilings), B5 bundle size in CI, the B3/B4 census
  module, spec, and ceilings, the B6 overlay, and this plan.
- **Done: G3 thread 1** (UI-only, no manifest). Month-keyed forecasts are computed after paint
  (`components/base/AfterPaint`), with the previous value kept on screen. Insights and the runway
  warning share one deferred twenty-year projection (`DeferredProjection`). Ticks commit once per
  dispatch (`connectToStore`). The BuildGenerators quote is memoized per game state. The rollover
  task drops from about 110–120 ms to under 50 ms in the dev census. The projection still runs as
  an 85 ms task one frame later.
- **Next: move the shared projection to a worker** (G3 step 4), the remaining rollover hitch.
- **Then:** one manifest-regenerating release that bundles the Immer tax, the reducer-side rollover
  savings, the G2 rAF presentation loop, and the `TICK_MS.FAST` decision.
- **Timeboxed spike:** Valgrind feasibility, kept only if it passes its criteria.

## Open questions

- `TICK_MS.FAST` 10 → 25/3 ms: FAST runs 20% faster in real time and a hashed constant changes.
  Todd's taste call before the G2 thread.
- rAF-driven presentation while the page is hidden. The page already pauses when hidden; confirm the
  rAF loop hands off to that pause cleanly.
- Tolerances for the B1/B7 ratio ceilings: they start at 25% and tighten once CI spread is known.
  The ceilings were recorded on darwin-arm64, and the Linux x64 CI runner may land elsewhere. If the
  first CI run disagrees, rebaseline from CI output rather than loosening the tolerance.
