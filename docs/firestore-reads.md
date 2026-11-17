# Firestore read investigation — 2026-11-16

## Measurement scope

Production console measurements belong in a private investigation report, not
in this public repository. Record a matched baseline privately before rollout;
include document reads, writes, deletes, listener/connection peaks, traffic
volume and the exact measurement window. Distinguish console usage and aggregate
queries from application document reads. A project-wide reduction cannot be
established from a client-side replay alone.

## Code findings and safe optimization

Base: `65c91444`. PR #781 (`2f78405d`, November 12) already introduced
single-owner foreground sync, one live manifest subscription, in-memory heads,
and a 60-second leaderboard cache. Do not replace those safeguards with polling.

The remaining confirmed repeat-read source is `src/Leaderboard.ts`: the same
public or private board is queried again after just one minute, even when it is
empty. Scenario selection eagerly requests five public difficulty boards, up to
10 documents each; the selected personal best adds up to one document. The
scenario-wide board is a separate, user-requested query capped at 50.

This change extends successful leaderboard/rank results to ten minutes. In-flight
requests remain deduplicated, errors remain immediately retryable, account and
scope keys remain isolated, and score submissions/name changes still invalidate
cached results immediately. Opening a scenario result also clears rows and ranks
before result subscribers read them, including completed, bankrupt and fired
runs without an account or competitive score submission. A successful remote
score write invalidates again afterward. Another player's scores can take up to ten minutes
to appear when revisiting a previously loaded board. This does not change save
freshness or achievement synchronization.

### Reproducible baseline and target

`src/Leaderboard.test.ts` calls the real loader ten times, one minute apart, with
an SDK mock. Before the change it observes **10 queries** and fails the one-query
budget; after the change it observes **1**. For a full ten-row result this is
100 → 10 returned documents per board. Empty boards also make 10 → 1 queries.
This is a **10× reduction for that replay**, not measured production billing.
Cold visits, full reloads, frequent invalidations and continuously changing rank
keys do not receive this reduction. No production-wide saving is claimed yet.

## Attribution without collecting player data

Open a build containing this change with `?firestoreReads=1` (preserve any other
query parameters). In developer tools:

```js
window.electrifyFirestoreReads.reset();
// Perform the workflow, then wait for its requests to settle.
console.table(window.electrifyFirestoreReads.snapshot());
```

The opt-in counters are memory-only, per page, and make no network calls. There
are no user IDs, document paths, names, scores, save contents or error messages.
Normal play does not expose the diagnostic API or accumulate counts.

| Source                    | What it identifies                                          |
| ------------------------- | ----------------------------------------------------------- |
| `leaderboard.rows`        | Board queries, including private bests                      |
| `leaderboard.rank`        | Aggregate rank requests                                     |
| `profile.load`            | Login profile reads                                         |
| `profile.rename`          | Bounded score-name backfill queries                         |
| `save.list`               | One-shot cloud manifest queries (subscription bypass)       |
| `save.listener`           | Subscription starts and authoritative snapshot deliveries   |
| `save.blob`               | Save payload chunk document reads                           |
| `save.transaction`        | Reads inside upload/cleanup transactions, including retries |
| `share.load`              | Shared-game manifest reads                                  |
| `share.transaction`       | Collision checks and retention transaction reads            |
| `achievement.transaction` | Achievement merge reads, including retries                  |

`requests` counts attempted SDK reads, `failures` their rejections, and
`documents` successful returned documents. Aggregates count requests separately
and do not infer billed index reads from their result count. Listener counters
track starts, server snapshots and delivered document changes (including removals),
not inferred billable reads. Metadata-only snapshots may deliver zero changes.
SDK cache behavior, empty query minimums, rules-dependent reads, retry semantics,
index billing, and other clients mean these counters **are not billing estimates**.
Start/reset only with previous work settled to avoid mixing measurement windows.

Replay on base and candidate using equivalent fixtures: ten mission-detail
visits one minute apart without reload; difficulty changes; result view; score
submission and rename; idle foreground play; hidden-tab return; two tabs;
cloud restore; shared-game loading. Record counters before and after each phase.
A rising `save.blob` count while idle points at repeated restores; rising listener
starts points at ownership/reconnection churn; `save.list` while subscribed
suggests an unexpected one-shot caller. A high production total with low local
counts requires investigating other clients/version distribution and server-side
request attribution rather than extending the cache again.

## Independent local QA — 2026-11-16

Headless Chromium at 1280 px and 390 px exercised the real local app against the
public Firestore boards for Wildfire Emergency (scenario 111), signed out. Each visit left the
detail screen completely before reopening it; the browser's `Date` advanced one
minute between visits without reloading the page. All five difficulties were
checked. Network evidence counted score-query `addTarget` and `removeTarget`
messages, independently of the diagnostic API. HTTP channel requests are a
different unit and were not treated as document reads.

- With the original 60-second TTL restored temporarily, visits at minutes 0–9
  made **50 queries and returned 300 documents**. The ten-minute candidate made
  **5 queries and returned 30 documents**, a **90% reduction in this replay**.
- Candidate runs with `?firestoreReads=1` and `?firestoreReads=0` had identical
  query traffic: 5 queries through minute 9, then 10 cumulative queries at
  minute 10. The enabled counters agreed with the network trace (30, then 60
  returned documents; zero failures). The disabled page exposed no diagnostic
  API. Both runs rendered the same selected-board row count without page errors.
- Quick Back/reopen navigation can reuse the still-mounted detail screen during
  its exit transition. Waiting for the old screen to unmount was necessary to
  exercise the shared cache and its expiry, rather than the component's own data.
- Review found that successful score writes were the only run-end invalidation
  path. Guest wins, unranked runs and losses therefore retained old boards.
  Store middleware now invalidates before delivering the result action to
  subscribers. Regression tests failed for all three outcomes before the fix
  and passed afterward; closing a result keeps the new cache intact.
- Regression coverage also checks empty/populated board and rank reuse, expiry
  at exactly ten minutes, explicit diagnostic opt-out, preserved errors/results,
  and no document-count callback work while diagnostics are disabled.

These are controlled client observations, not project-wide billing measurements.
The live audit did not sign into a player account, change scores or names, or
write cloud saves. Profile, save/share and achievement transport behavior is
covered by the focused unit suites; authenticated production sync and the
seven-day production acceptance window remain separate measurements.

## Production acceptance and approval boundary

No deployment, merge, rule/index update, App Check enforcement, alert creation,
or paid logging configuration is part of this change. Merging to `master` starts
the production deploy workflow, so approval is required before merging.

After approval, record the deployed version and a full comparable seven-day
window, keeping console Data views closed. Collect document reads, aggregates
from billing, writes, DAU/sessions and read counters from controlled replays.
Require total reads and reads per session/active user to fall by at least 90%,
with stable traffic and no increase in sync errors or lost progress. Use matched
windows and separate console/automation traffic; a change in user count alone
is not evidence of an optimization. If this gate is missed, use the source
counters and available request attribution to identify the remaining source
before proposing a further change. Enabling paid data-access logging or security
enforcement needs a separate cost/behavior review.
