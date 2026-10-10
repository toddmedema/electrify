# Save upgrades

Production deployments can change the broad challenge/replay rules fingerprint even
when the save's structure is unchanged. That fingerprint must not be a gate for
resuming ordinary progress. An open tab can also create a fresh save using the rules
of an earlier deployment. `appVersion` identifies the app release; it does not define
the save schema or establish equivalent simulation conditions.

## Schema migrations

`src/SaveUpgrade.ts` owns the independent integer `schemaVersion`. Unversioned saves
are schema 0. `SAVE_SCHEMA_VERSION` is the number of migrations, so a structural change
appends one ordered step and older steps remain unchanged. Each step receives a copy of
the decoded save (timeline, history and commitment records already unpacked from the
wire encoding) and the loader stamps the resulting version. The entire result then
passes the existing domain and outcome validation. Malformed versions and damaged game
state are rejected rather than guessed at.

A well-formed newer `schemaVersion` is reported as `incompatible`, not `invalid`, for
device saves, cloud backups, shared snapshots and imported files alike. The original
stays untouched; see [cloud saves](cloud-saves.md) for recovery downloads.

## Rules changes

Every save records the rules fingerprint it was written under as `rulesId`. The 0-to-1
migration takes it from the run identity of an unversioned save, or `legacy` when the
save has none. `parseSave` compares it with the running build. On a mismatch it
preserves game progress, records `upgradedFromRules`, and drops the challenge,
shareable run identity and replay action log. The discarded identity is not checked
further: it can no longer authorize anything, so it must not decide whether progress
loads. Continued play uses current rules and data. Scores remain visible locally, but
upgraded runs cannot submit to leaderboards or claim equivalent challenge/replay
conditions. Starting a new game clears this restriction. Current matching challenges
and deterministic replays are unchanged.

The same boundary covers IndexedDB reads, cloud restore, shared snapshots and file
imports. Reading a device save leaves the original stored payload intact; normal
subsequent saves persist the current schema, rules and upgrade marker through existing
atomic, revision-checked writes. Cloud restore stores the validated upgrade locally.
Cloud replacement follows the normal explicit-save/checkpoint rules; loading never
deletes the cloud original. Saved games identifies persisted upgrades and keeps Load
enabled.

For every new structural migration, add an old-schema fixture, assertions that
progress is retained, an idempotent current-schema round trip, malformed/future-schema
rejections, and a resumed simulation check. Do not relax challenge or replay validators
to make a save migration pass.
