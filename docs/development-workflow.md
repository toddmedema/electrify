# Local development coordination

Start with Node 26, `npm ci`, and `npm run check:assets`. Before editing, run
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

Local check, build, Jest, browser, simulation, benchmark and typecheck commands share three
machine-wide validation slots. Participating commands take the next available slot in queue
order. Nested commands inherit a verified parent reservation. Older checkouts still respect
the capacity limit and adopt queue ordering when updated. Use the npm entry points for
development validation.

Run `npm run task -- queue` from any checkout for a read-only snapshot of slot holders,
waiting commands in admission order, and standalone preview ports. Entries include the command,
checkout, task (when supplied), PID and age in milliseconds since the request. Queue positions
start at one. A cancelled or dead waiter gives up its place.

Top-level commands check the installation against the lockfile before entering the queue and
recheck dependencies after a wait. A stale installation fails with an `npm ci` instruction.
Electron's pristine lazy-download state is valid. An installed runtime must match its lockfile.

Browser/check commands print their reserved `E2E_PORT`. An explicit port must be available.
A standalone `npm start` keeps its port and checkout while serving. Startup and each webpack
rebuild acquire a validation slot, including asynchronous TypeScript checking. Completed
compilations release it while the HTTP server continues listening. Stop a preview when
finished with it. A preview inside a browser test shares the test command’s reservation. Leave other tasks’ listeners alone.

Reservations track processes, not elapsed-time limits. A live long-running check
is never evicted for being slow. Dead owners can be recovered, and nested command
lifetimes and cancellation are covered by child-process tests.

## Evidence and hosted CI

Before pushing, run the local checks that exercise the affected paths and their callers.
Record those results in the PR. Hosted CI supplies full-suite validation on each update.

Run `npm run check:prepush` after committing and before pushing a PR. It compares
`HEAD` with the merge base of `origin/master` and runs `npm run site:check` when
site inputs or generated pages changed. Pass the PR's base ref after `--` for a
different target. If the check finds stale metadata, use the actual authored
date when regenerating the pages.

### Merging to master

The [Protect master ruleset](https://github.com/toddmedema/electrify/rules/528373)
requires GitHub Actions' `check` on a branch that includes the current `master`.
Keep feature branches in flight in parallel. When several are ready, merge one
at a time and update the next candidate to the new base before relying on its
checks. Routine merges use the ruleset with its empty bypass list.

### PR monitor survey

`node scripts/dev/pr-triage.js --repo toddmedema/electrify` prints one compact JSON
snapshot of every open PR. It fetches only metadata: head/base commits, mergeability,
failed/pending head checks, and opaque GraphQL feedback IDs/update times from `toddmedema` and
CodeRabbit. It includes unresolved outdated threads for the monitor to assess;
resolved threads are omitted. Every relevant connection is paginated, and UNKNOWN
mergeability is retried once. Errors exit nonzero and never produce a clean result.

The helper is read-only. The monitor keeps its existing durable ledger, worker
ownership, three-attempt budget per unresolved issue, and body-on-demand feedback
assessment. A dispatched comment is not automatically handled, and an agent's
own push does not renew its attempt budget. The helper does not decide which
feedback is actionable or run repairs.

An installed monitor should load the helper from the current remote `master`,
using a temporary file when its checkout is on another branch. Until this helper
lands on `master`, keep the monitor's existing metadata query. Do not execute a
feature branch's copy as the shared monitor. Treat an API or helper error as a
failed survey, preserve the ledger, and report the error.

For repair pushes, have the monitor and its workers follow the
[local verification policy in AGENTS.md](../AGENTS.md#start-here). Reproduce the
failure where practical and check the fix and affected callers before pushing.
Use the full local profile when the scope or failure warrants it. Hosted CI runs
the full suite on the repair push.

### Validation evidence

Run `npm run check -- --status` to inspect the latest recorded local run without
claiming the checkout, reserving a validation slot, checking installation/assets,
or running generators or gates. Add `--json` for structured output, or pass a
report path: `npm run check -- --status .tmp/check-runs/<run>/report.json --json`.
Use `npm run --silent check -- --status --json` when piping JSON to another tool.
The newest run directory is selected by its timestamped name; an empty or broken
newest run reports unavailable evidence instead of falling back to an older pass.
Unavailable or inconsistent reports exit nonzero. Reports are replaced atomically;
older partial writes are treated as unavailable after one bounded read.

Status shows recorded scope, gate states, execution/reuse counts, source/runtime
provenance, timings, available evidence paths and failed-gate retry commands.
Every result is historical: status does not compare the current source, verify
environment/artifacts/evidence contents, or decide whether a gate can be reused.
Queued commands have no report yet, and owner liveness is unknown; even a report
marked `running` can belong to an abandoned command. Inspection never reruns checks
or authorizes skipping required gates. Use `--resume` for verified reuse decisions.
The existing `--report <report.json>` source-comparison summary remains available.

Check reports retain separate `timing.queueMs` and `timing.executionMs` values.
The complete hosted run covers all required gates, coverage thresholds, viewport
projects, diagnostic retries and flake rejection. Local reports describe the checks
selected for the change.

GitHub Actions keeps its existing isolated jobs and full/trimmed dependency
profiles. It bypasses local coordination and full-install preflight; its existing
dependency checks remain. Native workers still suppress generators when adopting
verified shared build artifacts. Packaged Electron window tests remain CI-only.

The same Test Code workflow also runs on `master` pushes to populate trusted Jest
transform caches for new PRs. A running master seed finishes even if another merge
arrives. Unit, simulation and multiplayer save-advance transforms have separate
caches; cached transforms never replace test execution.

Hosted browser, multiplayer and controller journeys retain the failing
attempt's action trace and failure screenshot, including when a retry passes.
The shared [CI performance guide](ci-performance.md#reliability-evidence)
describes how to compare source trees and timings.

Set `REVIEW_SCREENSHOT_DIR`
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
`benchmark-work=true`. After ordinary suites finish, the CPU worker compares cold and
restored transforms, the desktop worker compares one-shot and persistent save
advancement, and browser shard 1 captures review images at all three CI widths.
The reports are in `diagnostics-cpu`, `diagnostics-desktop`, and `diagnostics-browser-1-attempt-<attempt>`.
