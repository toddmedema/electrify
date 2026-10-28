# Local development coordination

Start with Node 24, `npm ci`, and `npm run check:assets`. Before editing, run
`npm run task -- claim`. Codex uses its chat ID automatically; other tools can set
`ELECTRIFY_TASK_ID` or pass an ID to the claim command. A different task must use
another worktree. `npm run task -- status` shows the owner; release your claim with
`npm run task -- release` when work is finished.

Claims persist across commands and interrupted chats. To recover an abandoned
checkout, first confirm that its task has finished, then run
`npm run task -- release <recorded-task-id>`. This only removes ownership metadata;
it never resets, cleans, switches, or deletes source files. Claims are cooperative:
arbitrary editors and Git commands can still change files. The check runner's
before/after source fingerprint continues to reject validation of changing source.

## Heavy work and ports

The existing npm check, build, Jest, browser, simulation, benchmark, and typecheck
commands acquire one of three machine-wide reservations before their generators or
tests start. When all three slots are occupied, a competing invocation waits without
suspending the current test. Nested commands inherit validated ownership, so
`check:ci` can invoke builds and tests
without waiting on itself. Direct Node invocations are for tooling tests and
diagnostics; use the npm commands for development validation.

Each top-level local command verifies that the installed dependency metadata and
versions match the lockfile. A stale or incomplete installation fails early with
an `npm ci` instruction. Electron's pristine lazy-download state is valid; an
existing runtime must match its locked package version. This is an install
consistency check, not a content-integrity audit of every dependency file.

Browser/check commands print their automatically reserved `E2E_PORT`. An explicit
`E2E_PORT` is respected and rejected if already occupied or reserved. Port ownership
is shared between participating commands; an unrelated program can still bind
after the availability probe, in which case server startup must fail. Never reuse
or terminate another task's listener. A standalone `npm start` holds its reservation
until stopped; stop your preview when finished so queued validation can proceed.

Reservations track processes, not elapsed-time limits. A live long-running check
is never evicted for being slow. Dead owners can be recovered, and nested command
lifetimes and cancellation are covered by child-process tests.

## Evidence and hosted CI

Check reports retain separate `timing.queueMs` and `timing.executionMs` values.
All existing gates, source-change detection, coverage thresholds, viewport
projects, diagnostic retries, and flake rejection remain required. Run focused
checks and requested reviews before the final integrated check.

GitHub Actions keeps its existing isolated jobs and full/trimmed dependency
profiles. It bypasses local coordination and full-install preflight; its existing
dependency checks remain. Native workers still suppress generators when adopting
verified shared build artifacts. Packaged Electron window tests remain CI-only.

The same combined test job also runs on `master` pushes to populate trusted Jest
transform caches for new PRs. A running master seed finishes even if another merge
arrives. Unit, simulation and multiplayer save-advance transforms have separate
caches; cached transforms never replace test execution.

Routine browser runs capture screenshots on failure. Set `REVIEW_SCREENSHOT_DIR`
to collect optional review captures as well; test/viewport subdirectories prevent
collisions. The layout and interaction assertions run in either mode.

Multiplayer save advancement keeps one lazy CRA/Jest helper per Playwright worker.
Every request reloads simulation data, restores its own UI-created save and runs
the original advancement assertions. To compare it with the one-shot CLI on the
same save, run `node scripts/ci/benchmark-world-advance.js <native-world.json>
<month>`. The benchmark reserves the local validation slot, alternates three rounds
of nine requests per mode, and requires identical output checkpoint hashes.

## Resume verified validation

After fixing a failed check, run `npm run check:ci -- --resume`. This still accounts
for all fifteen gates. Failed or invalidated gates execute; unchanged passing
gates can reuse retained evidence. Omit `--resume` to execute every selected gate
fresh. Hosted CI always executes normally, even if `--resume` is supplied.

The report marks each gate as `executed` or `reused`. Reused gates name their source
report in `reusedFrom`; their logs and structured reports are copied and verified
in the new run. A completed failed run can contribute its valid passes. Running
or source-invalidated runs cannot. Missing or altered evidence forces execution.

Keys include file contents and inventory, the command and environment, runtime and
worker settings, dependency metadata, local CRA environment files, and generated
inputs. Unknown files remain shared inputs. Known test-only changes can spare
unrelated simulation and build work, but imported test helpers remain dependencies;
uncertain imports fall back to the broader input set. A small set of existing
tooling loaders has audited, content-pinned targets; editing those loaders revokes
their exception. Staging or
committing unchanged bytes does not invalidate evidence.

Local integrated checks build web and desktop into separate directories under
`.tmp/check-builds/`. Build inventories and contents are verified before reuse;
missing or changed artifacts also invalidate dependent bundle/browser evidence.
Reused artifacts retain their original build version and provenance. Standalone
build commands and hosted CI keep their existing `build/` default.

Compatibility/icon inputs are generated before the check snapshot. Changes to ignored
behavior inputs, including local environment files, invalidate a run just like tracked
source changes. Cache reuse never authorizes a partial run to claim full coverage.

For isolated runner measurements, manually dispatch Test Code with
`benchmark-work=true`. It runs the ordinary combined test job first, then measures
one-shot/persistent save advancement, four covered suites with cold/restored
transforms, and optional review captures at all three CI viewport widths. Results
are retained in `diagnostics-tests`; no additional job or required gate is added.
