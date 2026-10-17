# Agent workflow review

The largest avoidable delays came from repeating expensive validation, discovering incomplete
worktree setup late, competing for the same workstation, and waiting for remote CI after the
requested local work was complete. The current game suite makes each repetition expensive.
There is no controlled evidence here that model inference itself became slower.

## Evidence

Reviewed ten substantive project chats updated October 14–16, 2026, including every available
turn, command durations, failures, reruns, and handoff messages. This includes archived chats;
brief capability and artwork questions and the still-active redesign were excluded. The findings
below summarize the chats without exporting their transcripts.

Times are elapsed command or turn durations, rounded to the nearest second. Commands and
subagents sometimes overlapped, so these values must not be added into a claimed total time saved.
Turn durations also include implementation and user-requested research or QA, not just overhead.

| Work reviewed                                                                                   | Observed delay or useful comparison                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Music and SEO, [PR 553](https://github.com/toddmedema/electrify/pull/553)                       | Two full checks took 351 s and 312 s. The first failed only lint; it had already passed tests and simulations.                                                                                                                                                     |
| Standardize menu page layout, [PR 549](https://github.com/toddmedema/electrify/pull/549)        | Four full checks across two implementation turns took 477, 227, 411 and 299 s. Missing LFS files caused one rerun. A broad browser command ran 180 cases and lasted 619 s.                                                                                         |
| Update data center and game UI, [PR 550](https://github.com/toddmedema/electrify/pull/550)      | A 510 s check discovered lint errors and LFS pointers; focused repair checks then passed.                                                                                                                                                                          |
| Research large-screen game UI                                                                   | Five full-check commands lasted 1477 s (aborted), 838 s, 755 s, 687 s and 714 s. Separate feature worktrees repeated validation; missing LFS assets and a later lint error caused failures. Requested design reviews also account for substantial legitimate work. |
| Draft multiplayer proposal, later [PR 543](https://github.com/toddmedema/electrify/pull/543)    | Proposal-only turns invoked 511 s and 676 s full-check commands. One then retried suites after sandbox temp-cache failures. The later implementation legitimately needed game validation.                                                                          |
| Update multiplayer time syncing, [PR 543](https://github.com/toddmedema/electrify/pull/543)     | Across five turns, 153 command invocations queried remote runs or PR checks. A 221-minute integration turn included repeated remote-platform waits and new base merges. This is not a measurement of 221 minutes spent solely waiting.                             |
| Plan non-Steam account support, [issue 546](https://github.com/toddmedema/electrify/issues/546) | Planning and issue updates generally completed in 2–12 minutes without full game checks. One recommendation required correction after inspecting an older PR instead of the current implementation.                                                                |
| Consolidate and trim tests, [PR 545](https://github.com/toddmedema/electrify/pull/545)          | A 302 s coverage baseline encountered LFS pointers; the final check command took 597 s. Baseline coverage comparison was appropriate for this task.                                                                                                                |
| Trim low-value tests and comments, [PR 544](https://github.com/toddmedema/electrify/pull/544)   | A 374 s full-check command failed on missing LFS media. The later command, including the repeated check and tutorial rerun, took 232 s.                                                                                                                            |
| Run local tests headlessly, [PR 539](https://github.com/toddmedema/electrify/pull/539)          | A 578 s full check found LFS pointers; a 218 s coverage rerun followed.                                                                                                                                                                                            |

Six of these ten chats explicitly encountered missing LFS media. Existing asset tests caught the
problem correctly, but only after launching the entire covered suite. The old instructions said
the full check took “about a minute,” required it even for proposals, and offered no named-gate
retry. The runner hid all results until the last gate completed and used Jest's all-core default
unless each agent remembered to set an override.

The tasks are not equal in scope: the large-screen task explicitly requested three separate PRs
and repeated design QA, so each PR needed validation. The first time-syncing request explicitly
asked for a fresh master merge, all tests and failure repairs. Those were authorized work. The
avoidable costs were late setup failures, repeating gates whose inputs had not changed, and
continuing remote waits and base updates through later UI followups. These records do not establish
a monotonic slowdown across comparable tasks.

The local checkout exposes 20 logical CPUs and about 31 GiB RAM. Several active feature
worktrees, builders and browser suites shared that machine. This supports resource contention as
a contributor; the records are not a controlled worker-count benchmark. Some chats already used
two, four or eight workers, so a cap alone cannot explain or fix every long run.

Repository discovery also included old nested checkouts: a music-task file listing returned both
the real source and duplicate files under `work/ci-speedup`. Repeated full-file reads and manual
log polling added context and tool overhead. Their time contribution is not separately measured.

## Changes

- `check:assets` inspects the first 80 bytes of tracked files under `public/` and `design/`,
  rejects missing files and LFS pointers, and gives recovery commands. Full checks run it before
  starting any gate; static-only retries do not require unrelated media. No assets are downloaded
  or modified automatically.
- The default check still runs all eight gates with the existing coverage floors and scenario
  suites. Local Jest workers default to `min(4, available CPUs)` and use worktree-local caches,
  avoiding the sandbox's shared temporary cache. Heavy gates remain serial.
- Gate results and errors print when they finish. A failure prints the exact `--steps` retry
  command. Unknown names fail before starting work; partial success is labeled explicitly.
- Agent instructions distinguish prose-only work, focused iteration, and the final integrated
  check. Passing gates remain valid only while their inputs stay unchanged. Subagents doing
  focused work leave final full validation to the integrating agent.
- Agent instructions end ordinary PR work after local validation and reporting current remote
  CI status. Requests to monitor, merge, or deliver green CI still require waiting.
- Root-level scratch checkouts and remote attachments are ignored, keeping normal searches and
  Git status out of old copies. Existing worktrees and files are preserved.

This follows OpenAI's guidance to keep agent instructions concise and focused on useful project
context rather than accumulate redundant workflow scaffolding.
[Official guidance](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra)

## Validation and limits

Regression tests cover preservation of all gates, strict step and worker validation, serial heavy
execution after failures, and real tracked-file preflight behavior for pointers, missing files
and untracked files. These exercise orchestration and failure modes without running a second game
simulation model. The repository's ordinary full check remains the acceptance check for this PR.

The PR branch passed all eight gates in 352 seconds on a fresh local Jest cache: covered tests
took 144 seconds and simulations took 175 seconds. All four workflow regression tests passed.

On this checkout, the new asset preflight checked 382 tracked files in 0.25 seconds, including
Node startup and Git discovery. This is a setup check, not a game-performance benchmark. In the
PR 553 example, retaining the successful simulation result after a test-query lint repair would
have avoided the second 158-second simulation gate alone.

The expected gains come mainly from avoiding work: catching bad setup before minutes of tests,
retrying only invalidated gates, and not running game tests for prose. The four-worker default is
a conservative shared-machine setting, not a claimed universal optimum. Game complexity, requested
review rounds, fresh lockfile installation and real regressions still take time. CI topology and
native UI coverage are unchanged.
