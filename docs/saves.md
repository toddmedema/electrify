# Save and replay formats

Electrify has not launched. Only the current save schema and simulation rules are
supported; there are no migrations, historical runtimes, or run-identity rewrites.
`src/SaveSchema.ts` owns the current integer schema tag. Changing the structure can
change that tag without adding an upgrade path.

`parseSave` validates decoded device, cloud, shared and file-import payloads before
play. Unsupported schemas and authored run identities from different rules are
rejected. Mod snapshots must match the current mod runtime and their frozen digests.
Validation leaves stored originals untouched. Current saves preserve their challenge,
recorded actions, policy queues, and commitment forecast through a round trip.

Challenges require the current rules fingerprint. Replays also carry this fingerprint
and recorded month-end cash checkpoints. Playback uses the real reducer; checkpoints
still detect unexpected divergence within the current build. A recorded final result
remains available for score presentation.

Co-op checkpoints require the current world schema, per-grid save schema and multiplayer
rules fingerprint. All grids and connections are validated together before resume;
individual grids are never imported as solo saves.

See [run compatibility](run-compatibility.md) for the generated fingerprints and
[cloud saves](cloud-saves.md) for synchronization and immutable shared snapshots.
