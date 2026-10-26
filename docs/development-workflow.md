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
commands acquire one machine-wide reservation before their generators or tests
start. A competing invocation waits without suspending the current test. Nested
commands inherit validated ownership, so `check:ci` can invoke builds and tests
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
