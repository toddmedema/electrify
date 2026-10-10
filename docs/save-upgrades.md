# Save upgrades

We deploy several times a day, and most deploys change the broad rules fingerprint
(`compatibilityId`) even when nothing a player would notice has changed. A deploy is
not a new game: saved progress upgrades silently and keeps everything it had. Players
are only told when this app is too old for a save, and are offered a one-click update.

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
stays untouched, and the message offers **Refresh to update**: page loads are
network-first, so a reload picks up the deployed version.

## Rules changes

`parseSave` carries an authored run saved under an earlier fingerprint forward to the
running rules (`carryRunForward` in `src/helpers/RunIdentity.ts`). It re-derives the run
identity from the scenario, seed and difficulty, moves a matching friend challenge to
the same reference, and keeps the replay log. The run still ranks, submits its score
and its replay, and compares against the challenge target. Nothing is shown to the
player. If the scenario no longer describes the game (removed, or moved to another
location), progress is kept without the shareable identity and challenge. A challenge
that never matched its own run is still rejected as corrupt.

Replays re-simulate under whichever build plays them, so a run that spans deploys is
no different from an older replay watched today. Each uploaded replay also records the
original run's month-end cash and final result. Playback reports the first month that
drifts (`replay_diverged` analytics) and the end screen always shows the score the
run actually earned.

The same boundary covers IndexedDB reads, cloud restore, shared snapshots and file
imports. Reading a device save leaves the original stored payload intact; normal
subsequent saves persist the current schema through existing atomic, revision-checked
writes. Cloud restore stores the validated upgrade locally. Cloud replacement follows
the normal explicit-save/checkpoint rules; loading never deletes the cloud original.

For every new structural migration, add an old-schema fixture, assertions that
progress is retained, an idempotent current-schema round trip, malformed/future-schema
rejections, and a resumed simulation check.
