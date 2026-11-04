# Save formats

Save structure evolves independently of app releases and simulation compatibility.
`src/SaveUpgrade.ts` owns ordered schema migrations. The current version is derived
from the first supported version (6) and the number of steps, and is re-exported by
`src/SaveSchema.ts` for writers and newer-app detection.

`parseSave` decodes packed records, migrates supported older structures as copies,
then applies the same domain validation used for current-format imports. Device,
cloud, shared and file-import payloads use this boundary. Loading never overwrites
the stored original; normal successful saves persist the upgraded structure through
the existing revision-checked repository.

Schema 6 drops retired replay fields. Schema 7 converts the old intertie trading
policy to independent buying and selling rules with the same permissions: imports
serve shortages and exports use surplus. Neither storage imports nor profitable
extra generation is enabled by migration. Recorded history, facilities, finances,
policy queues and commitment forecasts stay intact. Schema 8 adds a version fence:
apps without the continued-run ranking restriction must not load those saves.

Schemas before 6 are unsupported development formats. Missing, malformed and newer
schema tags are rejected rather than guessed at. A valid newer tag retains the
existing newer-app message. Migrations do not fill missing current-schema fields,
repair damaged progress, or bypass domain validation.

For a structural change, append one migration; never renumber or rewrite an existing
step. Add an old-shape fixture or representative payload, prove progress is retained,
keep a current-schema round trip idempotent, reject malformed and future schemas,
and advance a migrated game through the real reducer. Run the new acceptance test
against the prior loader to demonstrate that it detects the missing migration.

A coherent authored save from a different simulation fingerprint can continue under
the running rules after its progress passes the current domain checks. The loader
checks the prior identity against its embedded authored setup and any attached
challenge, then removes its shared identity and challenge and sets the persistent
`rulesChanged` marker. Such runs show their result but cannot submit a competitive
score. Once data loads, resumed continued runs rebuild only their future weather,
fuel prices, demand and supply forecasts under the running rules; recorded frames,
current-frame finances and history are retained. Repeated loads rebuild the same
forecast and also pick up later runtime changes after the old identity is gone.
Current fingerprints keep their existing canonical identity checks; corrupt
identity or challenge relationships are rejected rather than repaired. Starting a
new game clears the restriction.

Authored challenge links still require the current fingerprint, and mod snapshots
must match the current mod runtime and their frozen digests. See
[run compatibility](run-compatibility.md) for fingerprint generation. Historical
custom/mod formats and old co-op worlds are outside the solo migration contract.

Co-op checkpoints require the current world schema, per-grid save schema and multiplayer
rules fingerprint. All grids and connections are validated together before resume;
individual grids are never imported as solo saves. Solo migrations do not imply
that peers with different simulation or message formats can play together.

See [cloud saves](cloud-saves.md) for synchronization and immutable shared snapshots.
