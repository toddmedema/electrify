# PR testing performance

CI uses **six jobs per PR**: shared renderer builds, three native package builds, one
worker for all tests and static checks, and the required `check` gate. Unit, simulation,
security-rule, browser, multiplayer/mod and controller suites retain their existing cases,
viewports, seeds and coverage floors. Packaged Electron journeys now run once on Linux;
Windows and macOS retain native packaging verification but no longer execute UI journeys.

## Six-job layout

1. **Shared production builds** compiles/verifies the desktop renderer/catalogs and web build
   once each on Linux, checks bundle size, and uploads the artifacts. Separate input-validated
   compiler caches keep editions apart. The test worker owns strict lint, so CRA's duplicate
   lint plugin is disabled.
2. **Linux x64 build** packages and verifies the Linux depot.
3. **Windows x64 build** packages and verifies the Windows depot.
4. **macOS universal build** packages, signs and verifies one app containing both Intel and
   Apple Silicon slices. Neither slice is launched in this job.
5. **All tests and static checks** runs types, strict lint, formatting, native Node units, CI
   tooling, Firestore rules, the isolated tick-ratio benchmark, every covered Jest unit and
   long simulation, coverage validation, and the simulation CLI. It then packages its own
   Linux test depot and runs the complete PR browser matrix, multiplayer/mod management,
   controller journeys and the full packaged Electron suite under Xvfb.
6. **check** waits for the shared renderer job, all three native builds and the test worker.
   It passes only when every dependency succeeds. Failed, skipped, cancelled and timed-out
   results cannot pass the required gate. Workflow tests execute the gate's shell command
   against each of these outcomes.

The test worker and native package workers depend only on the shared renderer job. They run
independently: a native package failure cannot prevent testing, and a test failure cannot
prevent native packaging. Building a separate Linux test depot costs a few seconds and avoids
waiting for the Linux package job or transferring its large app directory. The required gate
uses GitHub Actions' dependency results directly, without polling the jobs API.

All heavy test phases run sequentially so CPU work cannot make UI deadlines depend on load.
Covered Jest and simulations use at most four workers, browser tests use two, and native
Electron and controller journeys use one. A failed phase does not skip later suites. Unit and
simulation discovery use a single `1/1` manifest; coverage validation still requires every
discovered unit suite to have passed and retains zero-hit files before enforcing the unchanged
`package.json` thresholds. Browser tests run the complete desktop/390 px smoke and
desktop/390/360 px layout matrix without sharding.

The combined test harness refuses local native-window runs. For a windowless reproduction of
its complete CPU plan, run `npm run test:ci-all -- --cpu-only` with Java 21 available for the
Firestore emulator. First run `npm run compatibility:generate` and `npm run icons:generate`,
because the harness suppresses redundant generation pre-hooks. Ordinary local validation
continues to use `npm run check` and `npm run check:ci`; the latter leaves native packaged
journeys to CI.

The test worker restores the full locked toolchain. All three native build workers use the
lean locked dependency profile. Every target verifies shared renderer assets against its
local checkout, packages natively and verifies native binaries; Mac also verifies both final
architecture slices and the finished signature. Native build jobs do not install browsers,
Java, Xvfb or a window manager.

The test worker caches Chromium's locked headless shell and native packaging downloads. It
uploads coverage, suite manifests, structured browser reports, traces and failure screenshots
even if a test phase fails. Browser, multiplayer, controller and packaged-desktop reports keep
separate directories. Native CI retains DOM/network traces and sources without a continuous
screenshot filmstrip during passing tests.

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
six jobs and full tests. PRs retain diagnostics but omit downloadable archives. Tar preserves
executable permissions; compressed archives upload without another compression pass.

## Timing

The original successful runs inspected on October 14, 2026 took roughly 9–12 minutes.
[The latest](https://github.com/toddmedema/electrify/actions/runs/38651304477) reached `check` in 9:28.
Measure the independent build and test paths separately within the six-job cap; native UI execution is now Linux-only.
Report measured end-to-end times, cache state and runner queueing in the PR. CPU suites stay on
Linux because measurements on the other platforms produced substantially longer simulation runs.
