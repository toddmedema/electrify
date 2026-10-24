# PR testing performance

CI has a hard cap of **six jobs per PR** and currently runs five, including the required
`check`. A regression test expands the platform matrix and enforces this limit. Every existing unit test, long simulation,
seed, browser viewport, native target, coverage threshold, security rule and performance gate
remains required on every PR.

## Five-job layout

1. **Shared production builds** compiles/verifies the desktop renderer/catalogs and web build
   once each on Linux, checks bundle size, and uploads the artifacts. Separate input-validated
   compiler caches keep editions apart. The broader strict lint gate remains required, so CRA's
   duplicate lint plugin is disabled.
2. **Linux x64** runs unit/simulation shard 1, its complete native/packaged desktop suites,
   Firestore rules and CI tooling regression tests.
3. **Windows x64** runs the headless controller journeys against the shared desktop renderer
   before packaging, then production browser shard 1 and its complete native/packaged suites.
4. **macOS universal** runs types, strict lint and formatting, then packages one app containing
   both Intel and Apple Silicon slices. It runs browser shard 2, multiplayer and the complete
   packaged suite against the arm64 slice. CI does not launch the Intel slice.
5. **check** runs unit/simulation shard 2 on another Linux runner, plus the CLI and isolated
   tick-ratio benchmark. It then requires all three native workers' latest results in this run
   to pass, merges raw coverage and enforces the unchanged `package.json` floors.

The required gate does useful CPU work before waiting for native results, avoiding another
job. Its read-only GitHub API query is pinned to the current run/commit and excludes itself. It
requires all three named native jobs, and fails on missing, failed, skipped, cancelled or timed-out
workers. A partial rerun can reuse unchanged successes from this run, while a newer pending or
failed job always supersedes its earlier success. Regression tests cover these conditions.

Every worker runs its CPU and UI phases sequentially, including covered Jest and simulations,
each bounded to half the cores. A failed phase does not skip the remaining suites. Browser
coverage keeps two Chromium workers; native Electron and controller journeys keep one UI worker.
Controller failures surface before the Windows worker starts packaging or browser work.
Separate browser, desktop and coverage directories retain each phase's reports. The combined
harness refuses local native-window runs. To reproduce a CPU shard without native windows,
run `npm run test:ci-platform -- 1 --cpu-only` (or shard `2`); this mode caps the local CPU budget
at four cores. First run `npm run compatibility:generate` and `npm run icons:generate`, because
the harness suppresses the test pre-hooks that normally create these local manifests.

Linux workers and the static-check worker restore the full locked toolchain. Windows uses a
lean native dependency closure preserving original locked runtime/tool records and native
platform entries. Every target verifies shared renderer assets against its local checkout,
packages/signs natively, verifies native binaries and finished signatures, and exercises every
desktop case. Native CI keeps DOM/network traces, sources and failure screenshots without a
continuous screenshot filmstrip during passing tests.

Browser workers cache and install only locked Chromium headless shells. Linux installs the system
libraries needed by Electron; Windows/Mac avoid repeated Windows Server media-feature setup.
The browser case union is identical to the original desktop/390 px smoke and desktop/390/360 px
layout matrix, now split across two workers.

## Shard maintenance

The Linux Jest workers use identical checked-in duration estimates. New files are included
automatically; private caches and discovery order never determine assignments. Update estimates
when measured load drifts. Coverage validates every discovered unit suite actually passed exactly
once and retains zero-hit files. Raw counters are merged; percentages are never averaged.

Local `npm run check`, `test:ci` and `test:sim` still run complete suites. The local check runner
caps Jest at four workers by default. Local and hosted production browser gates both use two
Chromium workers. CI generates manifests before its test phases and suppresses duplicate
generation pre-hooks. The CLI/ratio benchmark runs before its Linux runner's unit and
simulation suites.

Jest 27 binds the sandbox's existing `Math`, `Number`, `Object`, `Array`, `JSON` and `BigInt`
objects directly through `extraGlobals`, avoiding repeated VM global lookups in simulation loops.
These are the same built-ins from each isolated test environment. The production calculations,
deterministic power implementation, assertions, seeds and coverage instrumentation stay intact.
An isolated local comparison of the three CEO seed tests took 92s before extending the existing
`Math` binding and 67s after; measure whole-workflow time separately.
The timing benchmark keeps its original Math-only sandbox through a separate CRA entry point,
so its existing draft/plain ratio ceilings still compare the same execution environment.

## Reliability evidence

`npm run ci:history -- 100` groups recent failed PR runs by stable test file/title across
viewports, shifted source lines and branches. It counts each run once per test or gate,
separates passed retries, and links the contributing runs. It reports unreadable logs instead
of treating them as passes. Counts describe the latest attempt of each run; a later successful
rerun does not establish that its earlier failure was unrelated.

`npm run check -- --report <report.json>` summarizes a retained local check with its tested
commit, source fingerprint, runtime and full or partial scope. It explicitly reports whether
the current source matches. This command reads evidence; it does not run checks or combine
partial runs into a full pass. Native packaged tests remain CI-only and Firestore rules remain
a separate local command.

## Downloadable QA builds

Run **Test Code** manually with **Archive and upload all three verified offline desktop builds**
enabled, or `gh workflow run workflow.yml --ref <branch> -f qa-artifacts=true`. This uses the same
five jobs and full tests. PRs retain diagnostics but omit downloadable archives. Tar preserves
executable permissions; compressed archives upload without another compression pass.

## Timing

The original successful runs inspected on October 14, 2026 took roughly 9–12 minutes.
[The latest](https://github.com/toddmedema/electrify/actions/runs/38651304477) reached `check` in 9:28.
The stretch target remains at least 2x faster within the hard six-job cap and unchanged test policy.
Report measured end-to-end times, cache state and runner queueing in the PR. CPU suites stay on
Linux because measurements on the other platforms produced substantially longer simulation runs.
