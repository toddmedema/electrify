# PR testing performance

CI has a hard cap of **six jobs per PR**, including the required `check`. A regression test
expands the platform matrix and enforces this limit. Every existing unit test, long simulation,
seed, browser viewport, native target, coverage threshold, security rule and performance gate
remains required on every PR.

## Six-job layout

1. **Shared production builds** compiles/verifies the desktop renderer/catalogs and web build
   once each on Linux, checks bundle size, and uploads the artifacts. Separate input-validated
   compiler caches keep editions apart. The broader strict lint gate remains required, so CRA's
   duplicate lint plugin is disabled.
2. **Linux x64** runs unit/simulation shard 1, its complete native/packaged desktop suites,
   Firestore rules and CI tooling regression tests.
3. **Windows x64** runs production browser shard 1 and its complete native/packaged suites.
4. **macOS Apple Silicon** runs browser shard 2, its complete native/packaged suites, types,
   strict lint and formatting.
5. **macOS Intel** runs its complete native/packaged suites without extra shard jobs.
6. **check** runs unit/simulation shard 2 on another Linux runner, plus the CLI and isolated
   tick-ratio benchmark. It then requires all four native workers' latest results in this run
   to pass, merges raw coverage and enforces the unchanged `package.json` floors.

The required gate does useful CPU work before waiting for native results, avoiding a seventh
job. Its read-only GitHub API query is pinned to the current run/commit and excludes itself. It
requires all four named native jobs, and fails on missing, failed, skipped, cancelled or timed-out
workers. A partial rerun can reuse unchanged successes from this run, while a newer pending or
failed job always supersedes its earlier success. Regression tests cover these conditions.

Both Linux workers run unit and simulation suites concurrently, each bounded to half the cores.
The native Linux worker overlaps those suites with packaging and its serial Electron UI tests.
The two browser runners use a serial UI branch: package/verify, headless Chromium with two workers,
then the full Electron suite. Every native target keeps one UI worker, preserving focus isolation. Separate
browser, desktop and coverage output directories prevent Playwright cleanup from erasing a
concurrent report. The combined native-window harness refuses to run locally.

Linux workers and the static-check worker restore the full locked toolchain. Windows and Intel
use a lean native dependency closure preserving original locked runtime/tool records and native
platform entries. Every target verifies shared renderer assets against its local checkout,
packages/signs natively, verifies native binaries and finished signatures, and exercises every
desktop case. Native CI keeps DOM/network traces, sources and failure screenshots without a
continuous screenshot filmstrip during passing tests.

Browser workers cache and install only locked Chromium headless shells. Linux installs the system
libraries needed by Electron; Windows/Mac avoid repeated Windows Server media-feature setup.
The browser case union is identical to the original desktop/390 px smoke and desktop/390/320 px
layout matrix, now split across two workers.

## Shard maintenance

The Linux Jest workers use identical checked-in duration estimates. New files are included
automatically; private caches and discovery order never determine assignments. Update estimates
when measured load drifts. Coverage validates every discovered unit suite actually passed exactly
once and retains zero-hit files. Raw counters are merged; percentages are never averaged.

Local `npm run check`, `test:ci` and `test:sim` still run complete suites. On a shared workstation,
set `ELECTRIFY_CHECK_WORKERS=8` to bound workers without omitting tests. CI generates manifests
before concurrent work and suppresses duplicate generation pre-hooks in those test branches.
The CLI/ratio benchmark runs before concurrent work on its Linux runner.

Jest 27 binds the sandbox's existing `Math`, `Number`, `Object`, `Array`, `JSON` and `BigInt`
objects directly through `extraGlobals`, avoiding repeated VM global lookups in simulation loops.
These are the same built-ins from each isolated test environment. The production calculations,
deterministic power implementation, assertions, seeds and coverage instrumentation stay intact.
An isolated local comparison of the three CEO seed tests took 92s before extending the existing
`Math` binding and 67s after; measure whole-workflow time separately.
The timing benchmark keeps its original Math-only sandbox through a separate CRA entry point,
so its existing draft/plain ratio ceilings still compare the same execution environment.

## Downloadable QA builds

Run **Test Code** manually with **Archive and upload all four verified offline desktop builds**
enabled, or `gh workflow run workflow.yml --ref <branch> -f qa-artifacts=true`. This uses the same
six jobs and full tests. PRs retain diagnostics but omit downloadable archives. Tar preserves
executable permissions; compressed archives upload without another compression pass.

## Timing

The original successful runs inspected on October 14, 2026 took roughly 9–12 minutes.
[The latest](https://github.com/toddmedema/electrify/actions/runs/38651304477) reached `check` in 9:28.
The stretch target remains at least 2x faster within the hard six-job cap and unchanged test policy.
Report measured end-to-end times, cache state and runner queueing in the PR. CPU suites stay on
Linux because measurements on the other platforms produced substantially longer simulation runs.
