# Save upgrades

Production deployments can change the broad challenge/replay rules fingerprint even
when the save's structure is unchanged. That fingerprint must not be a gate for
resuming ordinary progress. An open tab can also create a fresh save using the rules
of an earlier deployment. `appVersion` identifies the app release; it does not define
the save schema or establish equivalent simulation conditions.

`src/SaveUpgrade.ts` owns the independent integer `schemaVersion`. Unversioned saves
are schema 0. The 0-to-1 migration adds the version to the existing structure. Future
structural changes increment `SAVE_SCHEMA_VERSION` and append an ordered migration;
older migration steps remain unchanged. Migrations work on copies and the entire
result passes the existing domain and outcome validation. Unknown future versions,
malformed identities and damaged game state are rejected rather than guessed at.

For a structurally valid save with an older rules fingerprint, the loader checks the
historical identity against the saved scenario, seed, difficulty and location. It
preserves game progress, records `upgradedFromRules`, and drops the old challenge,
shareable run identity and replay action log. Continued play uses current rules and
data. Scores remain visible locally, but upgraded runs cannot submit to leaderboards
or claim equivalent challenge/replay conditions. Starting a new game clears this
restriction. Current matching challenges and deterministic replays are unchanged.

The same boundary covers IndexedDB reads, cloud restore, shared snapshots and file
imports. Reading a device save leaves the original stored payload intact; normal
subsequent saves persist schema 1 and the upgrade marker through existing atomic,
revision-checked writes. Cloud restore stores the validated upgrade locally. Cloud
replacement follows the normal explicit-save/checkpoint rules; loading never deletes
the cloud original. Saved games identifies persisted upgrades and keeps Load enabled.

For every new structural migration, add an old-schema fixture, assertions that
progress is retained, an idempotent current-schema round trip, malformed/future-schema
rejections, and a resumed simulation check. Do not relax challenge or replay validators
to make a save migration pass.
