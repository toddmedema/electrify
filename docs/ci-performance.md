# PR testing performance

CI uses **ten jobs per PR**: shared renderer builds, three native package builds, five
Linux test workers, and the required `check` gate. Unit, simulation, security-rule, browser,
multiplayer/mod and controller suites retain their existing cases, viewports, seeds and
coverage floors. Packaged Electron journeys run once on Linux; Windows and macOS retain
native packaging verification.

## Job layout

1. **Shared production builds** compiles/verifies the desktop renderer/catalogs and web build
   once each on Linux, checks bundle size, and uploads the artifacts. Separate input-validated
   compiler caches keep editions apart. The CPU worker owns strict lint, so CRA's duplicate
   lint plugin is disabled.
2. **Linux x64 build** packages and verifies the Linux depot.
3. **Windows x64 build** packages and verifies the Windows depot.
4. **macOS ARM64 build** packages, signs and verifies an Apple Silicon app on an ARM host.
   The signed executable must be ARM64-only; the app is not launched in this job.
5. **CPU tests and static checks** starts immediately alongside the shared builds. It runs
   types, strict lint, formatting, native Node units, CI tooling, Firestore rules, the isolated
   tick-ratio benchmark, every covered Jest unit and long simulation, coverage validation,
   and the simulation CLI. It needs no compiled renderer, browser or native window manager.
6. **Production browser tests** runs three Playwright shards on separate Linux runners,
   with one worker per runner and the same shared web renderer. The combined matrix covers
   the existing desktop, 390 px and 360 px viewports.
7. **Desktop integration tests** downloads only the shared desktop renderer, packages its own
   Linux test depot, and runs multiplayer/mod management, controller journeys and the full
   packaged Electron suite under Xvfb.
8. **check** waits for both shared builds, all three native packages and all five test workers.
   It passes only when every dependency succeeds. Failed, skipped, cancelled and timed-out
   results cannot pass the required gate. Workflow tests execute the gate's shell command
   against each of these outcomes for every dependency.

The browser, desktop integration and native package workers depend only on the shared build
job. CPU checks have no build dependency. A native package failure cannot prevent testing,
any test worker can fail without suppressing another, and test failures cannot prevent native
packaging. Building a separate Linux test depot costs a few seconds and avoids waiting for the
Linux package job or transferring its large app directory. The required gate uses GitHub
Actions' dependency results directly, without polling the jobs API.

Each worker runs its heavy phases sequentially so CPU work cannot make UI deadlines depend
on load. Covered Jest and simulations use at most four workers. Each hosted browser shard,
native Electron worker and controller worker uses one. The unsharded local browser run
uses two. A failed phase does not skip later phases in its worker. Unit and simulation
discovery use a single `1/1` manifest. Coverage validation still requires every discovered
unit suite to pass and retains zero-hit files before enforcing the `package.json` thresholds.

The harness selects one explicit group with `npm run test:ci-all -- --group=cpu`,
`--group=browser` or `--group=desktop`. Unknown, conflicting and repeated options fail before
any suite runs. The default runs all groups; `--cpu-only` remains an alias for `--group=cpu`.
Groups containing native windows refuse local execution. For a windowless reproduction of
all CPU checks, use `--cpu-only` with Java 21 available for the Firestore emulator. First run
`npm run compatibility:generate` and `npm run icons:generate`, because the harness suppresses
redundant generation pre-hooks. Ordinary local validation continues to use `npm run check`
and `npm run check:ci`; the latter leaves native packaged journeys to CI.

All test workers restore the full locked toolchain. Each restores its own checkout and
cached dependencies, but production compilation stays in the shared build job. Only UI workers
install the locked Chromium headless shell; only desktop integration installs Xvfb and Openbox.
Unit/simulation transform caches belong to CPU checks, and the world-advance transform cache
belongs to desktop integration. All three native package workers retain the lean locked
profile and verify shared assets, native binaries and, on Mac, ARM64-only binaries and the signature.

Workers upload `diagnostics-cpu`, one `diagnostics-browser-<shard>-attempt-<attempt>` per shard,
and `diagnostics-desktop` even if a phase fails. CPU diagnostics include coverage and
suite manifests. UI reports retain structured results and failure screenshots.
Browser, multiplayer and controller journeys retain action-only traces of failing
attempts in CI. Packaged Electron retains its existing DOM/network traces. Each
harness saves `test-results/ci-<group>.json` with the checkout's Git commit and tree,
runner metadata, and phase results and durations. The Actions summary includes the
tree and phase durations. Compare trees on clean checkouts. A tree does not identify
local edits, build artifacts or runner conditions.

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
rerun provides another execution of that test.

Run `npm run ci:history -- --master 20` for recent `master` pushes. It separates
cancelled coverage, tests that passed on retry, tests that stayed red, and
runner-acquisition failures confirmed by job annotations. These signals can
overlap on the same run.

To compare a green PR and a red `master` run, read `source.tree` in their
`ci-browser.json` reports or use the trees of the actual checkout SHAs in the job
logs. A different tree needs a diff before assigning a cause. On matching trees,
compare first attempts by spec, test title and project in the Playwright JSON
reports. Report the first-attempt failures, median and slow-tail case durations,
and the slowest shard's elapsed time. Use the same Playwright version, artifact
and runner settings when measuring a timing change. Include all shards in coverage
counts and report queue time and total runner minutes separately.

`npm run check -- --report <report.json>` summarizes a retained local check with its tested
commit, source fingerprint, runtime and full or partial scope. It explicitly reports whether
the current source matches. This command reads evidence; it does not run checks or combine
partial runs into a full pass. Native packaged tests remain CI-only and Firestore rules remain
a separate local command.

## Downloadable QA builds

Run **Test Code** manually with **Archive and upload all three verified offline desktop builds**
enabled, or `gh workflow run workflow.yml --ref <branch> -f qa-artifacts=true`. This uses the same
ten jobs and full tests. PRs retain diagnostics but omit downloadable archives. Tar preserves
executable permissions; compressed archives upload without another compression pass.

## Timing

Two successful runs inspected on October 28, 2026 took roughly 37–38 minutes under the
combined test layout. [One run](https://github.com/toddmedema/electrify/actions/runs/40761411856)
spent 34m 41s executing checks: about 12 minutes in CPU/static checks, 11 minutes in browser
tests and 11½ minutes in desktop integration. The three groups now overlap on separate Linux
runners. A 15–18 minute workflow is an estimate to validate, not a measured result of the split.
Report measured end-to-end times, phase durations, cache state, runner queueing and total
runner minutes in the PR. CPU suites stay on Linux because measurements on the other platforms
produced substantially longer simulation runs.
