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
apps without the continued-run forecast refresh must not load those saves.

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
checks the prior identity against its embedded authored setup, removes the stale
identity, and sets the persistent `rulesChanged` marker. Upgraded runs retain
leaderboard eligibility and normal scenario-completion credit. The marker calls
for a forecast refresh. Once data loads, resumed runs rebuild only their future weather,
fuel prices, demand and supply forecasts under the running rules; recorded frames,
current-frame finances and history are retained. Repeated loads rebuild the same
forecast and also pick up later runtime changes after the old identity is gone.
Current fingerprints use canonical identity checks. Saved friend challenges require
a score target and a matching scenario and difficulty. Starting a new game clears
the forecast-refresh marker.

Mod snapshots must match the current mod runtime and their frozen digests. See
[run compatibility](run-compatibility.md) for fingerprint generation. Historical
custom/mod formats and old co-op worlds are outside the solo migration contract.

Co-op checkpoints require the current world schema, per-grid save schema and multiplayer
rules fingerprint. All grids and connections are validated together before resume;
individual grids are never imported as solo saves. Solo migrations do not imply
that peers with different simulation or message formats can play together.

See [cloud saves](cloud-saves.md) for synchronization and immutable shared snapshots.

Schema 13 located Across the Valley facilities by provenance. Schema 14 replaces
its physical routing with a company pool and a dated cash land receipt. Existing
paid land projects grant rights immediately; their original invested capital,
construction/upgrade progress, debts and financing terms remain in a frozen legacy
ledger. No refund or new fee is booked. Historical readings, PPAs, acquisitions,
facilities and oversized existing projects remain. Loan payments continue, while
wire construction, upkeep and congestion cease. Land value is counted once.
Current saves validate owned locations, canonical land prices and bounded legacy
investments; version 1 physical markers cannot enter the current runtime.

Schema 15 extends land receipts to every neutral parcel. Schema 16 assigns one
physical tile per facility in Across the Valley, preserving the facility's capacity,
stored energy, construction, financing and history. Cities have no building slot.
Older over-budget fleets get separate legacy overflow cells rather than losing
facilities; current saves reject invalid or duplicate placements.

Schema 17 adds individual tile purchase receipts while retaining earlier paid
whole-area rights and their exact capital value. Coordinate-derived frontier
geography needs no stored infinite board; receipts and active connections determine
the visible three-hex frontier.

Schema 18 requires physical adjacency to owned property for new tile purchases.
Older paid receipts retain their original visibility rule, property and exact cash
balances. The inland authored ocean becomes a lake; installed offshore plants
retain their plant-specific siting and wind inputs. Selling the plant removes
that installation exception and never grants replacement offshore access.

Schema 19 adds optional capacity-expansion projects. Older saves need no new
project fields. Current saves validate the target, retained installed capacity,
construction progress, capital terms and unique project identity. An imported
pending project cannot bypass technology, era or terrain limits; inherited
installed plants retain their existing capacity.

Schema 20 adds optional coal-to-gas repower projects without changing existing projects.

Schema 21 records the distance to the nearest owned city on new ordinary tile
receipts. Older receipts keep their exact parcel prices. Later city acquisitions
leave previous receipts and invested capital intact.

Schema 22 adds optional territory weather. Existing runs start tracking it at
the next monthly check.

Schema 23 rebuilds the Valley's acquisition and retention goals from saved customer
history and dated ownership receipts. Paid assets, customer history and finances
remain intact. Saves made with the schema 22 acquisition preview retain their
recorded evidence for the new goals.

Schema 24 adds optional loans to capacity-expansion projects. Existing cash
projects and loans retain their terms. Schema 23 saves from the map branch
also migrate their earlier Valley goals using the same evidence as schema 22.

Schema 25 introduced the scenario, difficulty and score target for saved friend
challenges. Ordinary schema 24 saves advance to 25 without a data conversion.

Schema 26 records the seller fleet rules for Across the Valley. Existing runs
retain their original NPC generator ages and acquisition prices.

Recognized published schema 13, 14, 15, 16, 17, 19, 20, 21, 22, 23, 24 and 25 co-op identities
have ordered transitions that preserve the run's original scoring provenance.
Existing company-local land rights, including old duplicate ownership, are
retained. New claims are exclusive and checked in host command order. Other
incompatible co-op identities retain their existing rejection behavior. See
[territories](territories.md).
