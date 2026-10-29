# Realtime multiplayer proposal

Two to four players, one shared clock, automatic live trading. See the [desktop guide](desktop-steam.md) for the implemented setup and save behavior.

**Play neighboring electricity companies together. Everyone sees the same moment. When your grid has spare power and another player needs it, electricity flows automatically.** Build more generation or improve the connection to help more. Your neighbor pays for the energy actually delivered.

Recommend a **Steam friends co-op mode hosted by one player's computer**. That computer runs all participating grids and clears their trades together. Steam carries the messages; no developer-operated game server is required for this first release. Firebase can remain optional for shared backups later.

## How it plays

1. Create a private lobby for **two, three, or four players**. Choose locations and a common starting year, difficulty, and campaign length. Use a multiplayer setup with comparable starting grid sizes and different generation opportunities.
2. Everyone uses the normal game view. Build plants and storage, manage customers, inspect forecasts, and change operating policies using the familiar controls. Save and leave through the existing top-left menu. Construction completes on the common clock.
3. **Serve customers, help neighbors, then store leftovers.** Trading is automatic. Your customers and a small automatic safety margin come first; eligible spare generation can supply another player's shortage. Optional battery charging yields to that shortage.
4. Watch each connection's direction, MW, remaining headroom, and price. A shortage can ease immediately as a neighbor increases generation, the wind changes, or a line upgrade finishes.
5. Each player selects a speed; the shared clock uses the slowest selection. Show the active speed alongside your selection and every player's selection. Build screens, notifications, backgrounding, and mandatory decisions pause the group without changing those selections. Closing an interruption restores the slowest remaining speed. Manual pause belongs to the player who selected it.

There is no year-end waiting room. Default to NORMAL speed, approximately 17 simulation ticks per second, with the same speed choices as single-player. A faster selection only speeds up the game when every player's selection permits it. Everyone confirms readiness at startup and after disconnects or save recovery.

Keep the objective cooperative and unranked: maintain each company's service and finances while meeting a shared emissions goal. Show who supplied useful energy and funded infrastructure. Use real four-player playtests to tune interruption frequency; four sets of mandatory decisions could otherwise stop play too often.

## Every player becomes a neighbor

Each company starts with an operating **tier 1 intertie to every other player**. Multiplayer interties connect only to players; NPC market connections are removed. With four players, every grid has three human-neighbor connections. **Even a location with no normal interties supports four players**, including islands.

| Players in the match | Human connections shown at each grid | Shared connections in the whole match |
| -------------------: | -----------------------------------: | ------------------------------------: |
|                    2 |                                    1 |                                     1 |
|                    3 |                                    2 |                                     3 |
|                    4 |                                    3 |                                     6 |

For example, Alice connects to Bob, Cara, and Dan from the start, regardless of her location's normal NPC neighbors. A location with zero NPC neighbors gets the same three connections.

The Alice–Bob connection is **one shared wire**, shown from both ends. It has one capacity, one construction state, and one flow. Alice exporting 20 MW means Bob importing 20 MW. Replacing a neighbor removes its old NPC supply, prices, and access allocation from that slot; the human connection gets its power from the other player's actual grid.

Start everyone with useful but limited connections, using multiplayer ratings calibrated to grid size. Native corridor counts should not give some players free extra transmission capacity. An upgrade affects the same shared wire at both ends. Its two owners approve the cost split; the host checks both contributions and creates the project atomically using normal cash or financing. Charge its operating costs and construction emissions once, with their agreed allocation.

## How much power can move

For one supplier and one buyer:

```text
Delivered MW = min(available wire MW, eligible spare generation MW, buyer shortage MW)
```

Eligible supply includes renewable surplus and extra output that running gas or coal units can physically deliver after local needs and the safety margin. Ramping, weather, fuel, water, and operating limits still apply. A plant's unused nameplate capacity is not automatically available electricity.

Initially, **automatic peer exports increase output of units kept online for domestic customer service or normal commitment, independently of peer demand and optional battery charging**. Charging a battery must not disguise an export-only start. An idle plant can still start normally for its owner's needs. Starting a plant solely to export is a later dispatch feature: it adds minimum-output and startup-cost decisions. Show eligible running headroom separately from installed capacity. Batteries initially discharge for their owner's customers, and imports cover customer shortages rather than charging batteries for resale.

When several players need the same supply, share it fairly across the whole network. Alice cannot sell the same 120 MW three times, and sending a request first gives no priority.

For example, Alice has **120 MW of eligible spare gas output**. Bob, Cara, and Dan lack 60, 90, and 150 MW. With sufficient wire capacity, they receive **24, 36, and 60 MW**: each shortage falls by 40%. If Dan's connection limits him to 50 MW, redistribute the remaining supply: Bob receives 28 MW, Cara 42 MW, and Dan 50 MW.

Each connection explains its limiting factor in words: **Line full**, **No spare generation**, **Plant offline**, **Generator ramping**, **Reserve protected**, or **Running cost exceeds price**. When Alice's own load rises, her exports shrink on the next shared tick. Delivered power creates real fuel costs and emissions at the source; it is not a promise to generate later.

## One visible price

Use **one posted multiplayer electricity price**, fixed before each tick and indexed to a shared fuel-price profile. The multiplayer preset authors its reference price and bounds; calibrate them before release. Everyone sees the same rate. There are no bids or individually negotiated contracts.

Only offer extra thermal output whose incremental running cost is covered by that rate. The initial restriction on export-only starts keeps a small sale from unexpectedly triggering a large startup bill. Sellers still pay normal construction, maintenance, and domestic startup costs; selling power does not guarantee that an investment pays for itself.

Every delivered MWh creates an equal buyer payment and seller receipt at that tick. Use the existing representative-day time weighting for energy and money. Show import spending and export income clearly. Players can restrict buying or selling with the trading controls; the automatic price is not a guarantee that imports are affordable indefinitely.

Player trades use direct bilateral links, with one common allocator. Do not immediately re-export purchased electricity or route another player's trade through a third utility. Multiplayer has no NPC fallback.

## Hosting and recovery

Steam hosting keeps the operating burden low: one trusted friend is the authority for all grids. The others send decisions and receive the results. The host cannot earn official competitive scores for the group; host authority provides consistency, not protection against a dishonest host.

| Event                    | Initial release behavior                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| A guest disconnects      | Pause everyone and preserve the seat. Reconnect to the current shared state, keep waiting, or save and end the session.   |
| The host leaves normally | Pause, distribute a complete shared save, obtain a saved-copy acknowledgement, then close.                                |
| The host crashes         | Stop the session. A player with a shared save can create a new lobby and resume it. Progress after that save may be lost. |
| A company fails          | That company retires at the month it failed; the others keep playing (see desktop-steam.md).                              |

Do not substitute the old NPC when someone disconnects. Their fleet, assets, customers, and finances stay in the save. Rejoining restores the same seat. Late additions of new seats can wait; the original roster stays fixed for the campaign.

Target a complete shared checkpoint every ten wall-clock seconds, plus explicit Save and Quit. Measure compressed size and upload cost before fixing that interval. A checkpoint counts as shared only after another participant has persisted and acknowledged its complete bundle and hash. Show the actual last shared-save time. If persistence falls too far behind, pause and report the problem. A purchase can be applied before it is durably saved; those are separate acknowledgements.

Always retain a complete local host save too. If remote persistence is unavailable, bound the shutdown attempt, save locally, and exit with the copy labeled local only. That complete local bundle can still resume the match; it is not a redundant shared copy. Saving must not require an absent guest to return before the host can close.

This avoids seamless host migration in the first release. Steam lobby ownership changing does not transfer the running simulation or its save automatically. Resume is an explicit new session from one complete checkpoint. Everyone must use matching game code and data during that session.

Resume accepts only current world and save schemas with a matching multiplayer rules
fingerprint. Validate all grids and edges together before play. Unsupported formats
remain untouched; do not migrate individual grids or entire checkpoints.

## Engineering appendix

The player rules are simple. The substantial engineering work is making the existing simulation resolve several grids together, accurately.

### One authoritative world step

The host runs the simulation in a worker independent of React rendering and Steam's native callback loop. Each step advances **all grids to the same calendar tick**:

1. Validate and order player commands; prepare weather, demand, and local dispatch plans from the same pre-tick world.
2. Determine eligible offers and shortages, with domestic service and the automatic reserve protected. Plan storage without consuming its energy yet.
3. Allocate player trades globally; apply optional charging under the stated priorities.
4. Commit final generation, storage, water, construction, cash, and emissions **once**. Publish the resulting world revision.

Do not call the current whole-grid tick for Alice, then for Bob using Alice's finished result. That creates order advantages and settles one company before the common market exists. Do not mutate a generator twice to ramp it for domestic load and then again for exports. Reachable output must be calculated from its original pre-tick output.

`Game.tsx` currently combines dispatch, trading, finances, and effects. Thermal dispatch follows domestic demand/storage, and exports sell already-produced surplus. `StoreRegistry.tsx` also points to one global store. Extract shared planning/settlement calculations and return per-player effects rather than registering four competing stores. Preserve single-player behavior and the protected import-order boundary. See [game simulation](../src/reducers/Game.tsx), [store registry](../src/StoreRegistry.tsx), and [transmission helpers](../src/helpers/Transmission.ts).

Use a small constrained allocator: maximize total customer shortage served; among those solutions, improve the covered fractions fairly, freezing buyers whose wire constraints prevent further improvement; break remaining ties deterministically. It must reroute assignments when necessary. Independent per-link `min` calls can double-sell supply, while greedy line ordering can leave avoidable shortages. This is continuous allocation over eligible output, not an optimizer for cold-start commitment.

Disable all authored NPC offers and corridor construction during the match. Both actual settlement and forecasts must respect the player-only network. Future human supply remains unknown to a local forecast.

Count internal energy transfers and money once. Group emissions count generation, external purchases, and construction once; summing each player's local-plus-imported emissions would double-count player trades. Forecasts must label neighbor supply as an estimate; future human decisions are unknown.

### Connection ratings and upgrades

Let `B_i` be grid i's starting player-network budget. Try **25% of its opening peak demand** as a balance hypothesis. For a locked roster of N players, initialize each shared edge as:

```text
C_ij = min(B_i, B_j) / (N - 1)
```

For equal 1,000 MW grids, the hypothesis gives 250 MW per grid in total: one 250 MW player connection in a two-player game, or three connections of about 83 MW in a four-player game. A paid upgrade grows its shared edge; `B_i` is the starting calibration, not a hidden permanent ceiling. Do not recalculate ratings when a player disconnects.

Apply weather availability once per shared edge, using the more restrictive endpoint factor under one declared link profile. Both local rows read that same adjusted rating. Independent local corridor calculations must not give the two ends different capacities.

Freeze the complete player network in the lobby. Give each peer link an explicit runtime corridor definition and expose its tier 1 line through the normal intertie interface. Do not inherit two incompatible endpoint ratings or charge two copies of the same project.

### Continuous synchronization

The host owns the clock, command order, and settlement. Schedule each simulation step at the slowest effective player speed, with **10 network updates per second**. These rates are separate: every simulation tick clears trades; network updates may contain several completed ticks. This is continuous play with ordinary network delay, not four independent clocks.

Clients send reliable, allowlisted gameplay commands carrying match ID, session epoch, authenticated seat, player sequence, and stable command ID. The host validates ownership and current legality, applies each once at an authoritative command boundary, and returns its revision and calendar tick. Never accept arbitrary client Redux actions or state patches. The host's own controls use the same path. Clients display pending purchases until acceptance; they do not spend authoritative cash locally.

**World revision and calendar tick are different.** While paused, the worker still processes decisions, builds, shared approvals, and readiness. Those commands can change ownership, charge an immediate purchase cost, and advance the revision without advancing time, ramping, fuel/water use, construction progress, or operating accruals. Forecast updates remain forecasts. This prevents a mandatory decision from waiting forever for the very tick it has paused.

Replicate owned-grid state and partner summaries using revision-tagged updates. Missing delta bases require a fresh snapshot; stale session epochs and out-of-order updates are discarded. Limit queued updates and resynchronize lagging clients. UI interpolation is cosmetic and never feeds trade calculations. Slow host computation slows or pauses the common clock; it must not skip economic ticks or race through a large catch-up after sleep.

Shared saves include every grid, all edges, calendar tick, rules/data versions, and command-deduplication state. Chunk and verify a whole bundle before acknowledging persistence. Manual resume creates a new session epoch and loads one chosen complete bundle for everyone. Discard pending commands and receipts from the old session; later unsaved purchases must not automatically retry against the restored economy. A normal single-player save is insufficient.

Use modern Steam NetworkingSockets for connection lifecycle and reliable/unreliable messages. The installed binding's old P2P API is deprecated; this needs a tested native bridge through the existing single callback dispatcher. A lobby alone is not the game-state transport or a durable save. See [Steam networking](https://partner.steamgames.com/doc/features/multiplayer/networking), [NetworkingSockets](https://partner.steamgames.com/doc/api/ISteamNetworkingSockets), and [lobby ownership](https://partner.steamgames.com/doc/api/ISteamMatchmaking#SetLobbyOwner).

## Firebase and browser support

Firebase remains viable for small-scale live relaying, but it does not replace simulation authority. A player-hosted browser still stops when its host closes or is suspended. Do not invoke a Cloud Function for every simulation tick.

Illustrative four-player relay costs at 10 publications/second, assuming one publication reaches three remote clients for a full hour:

| Relay             | Traffic assumption                                                 | Approximate marginal charge before free allowances         |
| ----------------- | ------------------------------------------------------------------ | ---------------------------------------------------------- |
| Firestore         | One document/publication: 36,000 writes and 108,000 listener reads | $0.065 per room-hour for document operations at Iowa rates |
| Realtime Database | 2 KiB/publication delivered to three clients                       | 0.221 GB downloaded; about $0.22 per room-hour             |
| Realtime Database | 10 KiB/publication delivered to three clients                      | 1.106 GB downloaded; about $1.11 per room-hour             |

These are calculations, not measured game traffic. Add protocol overhead, commands, snapshots, storage, reconnects, and other billing dimensions. Multiple per-player documents increase Firestore operations. RTDB bills downloaded traffic, including protocol overhead; Firestore listeners bill updates. See [Firestore rates](https://cloud.google.com/firestore/pricing), [listener billing](https://firebase.google.com/docs/firestore/pricing), [Firebase pricing](https://firebase.google.com/pricing), and [RTDB billing](https://firebase.google.com/docs/database/usage/billing).

RTDB also publishes an approximately 1,000-writes/second/database guideline; one 10 Hz write per room approaches that at about 100 rooms before commands. See [RTDB limits](https://firebase.google.com/docs/database/usage/limits). Steam hosting avoids operating this relay for the initial Steam-only mode. Browser/Steam crossplay is a separate transport decision.

If browser crossplay and independence from a player host are launch requirements, evaluate a managed authoritative WebSocket room service using the same shared engine. That adds hosting costs, deployment, room ownership, and reconnect operations. Cloud Run supports WebSockets but has request timeouts and scaling/routing requirements; it is not automatic stateful-room hosting. See [Cloud Run WebSockets](https://docs.cloud.google.com/run/docs/triggering/websockets). Choose this explicitly rather than quietly adding it to the Steam-host plan.

## Build and review gates

Start with a local four-grid harness and the real calculations. Stage a gas rescue, competing buyers, weather-driven flow reversal, an upgrade, and battery charging yielding to a neighbor's shortage. Then connect four actual Steam accounts and test four-player playability.

Require these before release:

- **Market correctness:** source capacity sold once; mirrored flows, payments, and energy; no battery/water double consumption; ramp limits from pre-tick output; no exports from unsupported cold starts; no startup-cost auction hidden in the allocator.
- **Four-player fairness:** the numerical shortage example; a constrained graph that requires reassignment; both zero-NPC and one-NPC locations joining a four-player match; tier 1 links to every player; stable ratings after disconnect/rejoin; no NPC fallback or immediate re-export.
- **Recovery:** duplicate purchases, delayed/out-of-order updates, lost acknowledgements, guest loss, host crash during saving, damaged bundles, unsupported schemas, and a crash immediately after a shared failure. Test resolving mandatory choices and buying while paused, and rejecting old-session command retries after resume. Only a fully persisted checkpoint may be offered for resume.
- **Performance:** host tick time and simultaneous month rollovers with four grids; Steam callback responsiveness; compressed update/checkpoint sizes; upload bandwidth; slow-client behavior; minimize, sleep, and resume. Measure before enabling FAST or ULTRA.
- **Enjoyment:** a player understands why help stopped through the normal game interface; running gas assistance feels immediate; all four players contribute; pause frequency is acceptable; wires do not replace generation. Test an idle gas plant whose owner's customers are covered by renewables while a neighbor needs power. If that restriction repeatedly frustrates players, expand dispatch before release.

Keep protocol details behind the interface. The main screen should need only a common clock, a pause control, your own grid, and clearly labeled neighbor flows. Run the repository's normal checks and coupled reducer/invariant scenarios for implementation, plus native Steam acceptance and desktop/phone layout checks where supported.

## Review findings

| Round | Design and technical challenge                                                                               | Resolution                                                                                                                           |
| ----- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Four independent grid ticks can create or double-sell power; authored geography cannot supply all peer slots | One shared world step and six canonical edges for four players, with explicit added slots                                            |
| 2     | Startup-aware auctions recreate complexity; disconnected automatic grids introduce unresolved choices        | One posted price, running-unit export headroom first, and pause/reconnect/save on disconnection                                      |
| 3     | Paused commands can deadlock; old purchases can repeat after recovery; unsupported versions cannot resume    | Keep command handling active while paused, enforce session epochs, validate whole matches together, and explain offline plant limits |
