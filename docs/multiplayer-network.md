# Multiplayer publication measurements

The first network reduction keeps complete snapshots and the shipping Steam compression/framing
codec. It suppresses unchanged views, batches command-triggered publications before cloning grids,
and bounds ordinary updates to 5 Hz. Commands, pause activity and readiness changes use a 100 ms
publication bound. Bootstrap, disconnect, reconnect and explicit checkpoint requests force an
immediate complete baseline. Duplicate/rejected commands still receive their receipt, without
cloning other seats when the world is unchanged.

A 1 Hz host keepalive carries only match, epoch and revision. Guests accept it only from their
authenticated current host, for the installed match/epoch and a safe non-stale revision. It updates
connection liveness without replacing a view, clearing pending commands or dismissing command/save
errors. Guest heartbeats, five-second safety deadlines, ordered command retries, native backpressure
and complete ten-second checkpoint persistence remain in place.

## Reproduce

Use Node 26 with the lockfile dependencies installed:

```sh
node scripts/perf/multiplayer-network.js > network-results.json
```

The benchmark initializes the real two- and four-player worlds in San Francisco, Honolulu,
San Juan and Pittsburgh, then advances the normal simulation to month 48 without purchasing
additional facilities. It measures complete remote-seat views and the complete shared checkpoint
through the shipping stringify/deflate/chunk/reassembly codec. Each measurement discards a warmup
and reports the median of three runs; timings are diagnostic, not gates.

Traffic rates below combine these measured payload sizes with a deterministic ten-second timer
model. The model runs the actual new publication queue alongside the previous loop's 100 ms check,
with browser timer flooring and no simulation/transport execution time. The old loop publishes at
different rates for each speed: 4 Hz paused, 5 Hz at 1×, 8.3 Hz at 3×, 8.9 Hz at 12× and 9.6 Hz at
24× in this model. The new queue publishes zero unchanged paused views and up to 5 Hz while running.
These estimates do not claim observed Steam traffic or measured frame performance.

## Recorded result

Recorded on Windows x64, Node 24.14.0. All sizes use decimal KB. Host egress sums every remote
recipient, excluding the host's local view. Wire bytes include the application's chunk headers,
compression and checksum framing, but exclude Steam/IP overhead.

| Players | Month | Raw complete publication | Wire complete publication | Clone all seats | Encode remote seats | Decode remote seats |
| ------: | ----: | -----------------------: | ------------------------: | --------------: | ------------------: | ------------------: |
|       2 |     0 |                 165.1 KB |                   19.9 KB |         1.55 ms |             2.00 ms |             2.40 ms |
|       2 |    48 |                 298.5 KB |                   53.2 KB |         3.34 ms |             4.22 ms |             4.75 ms |
|       4 |     0 |                 499.5 KB |                   65.1 KB |         3.43 ms |             6.37 ms |             8.05 ms |
|       4 |    48 |                 901.3 KB |                  162.7 KB |         8.01 ms |            13.81 ms |            15.21 ms |

The steady-state estimates include the unchanged complete checkpoint sent to every guest every
ten seconds, plus the new keepalive. They exclude bootstrap, command bursts, reconnects, manual
saves, incoming guest heartbeats and small save acknowledgements.

| Players | Month | Paused before → after | Paused reduction |   24× before → after | 24× reduction |
| ------: | ----: | --------------------: | ---------------: | -------------------: | ------------: |
|       2 |     0 |       83.8 → 4.4 KB/s |            94.8% |   195.2 → 103.8 KB/s |         46.8% |
|       2 |    48 |     223.6 → 11.0 KB/s |            95.1% |   521.5 → 276.9 KB/s |         46.9% |
|       4 |     0 |     286.5 → 26.6 KB/s |            90.7% |   650.8 → 351.9 KB/s |         45.9% |
|       4 |    48 |     716.1 → 65.8 KB/s |            90.8% | 1,626.9 → 879.1 KB/s |         46.0% |

At 3×, estimated savings are about 38–39%; at 12×, about 42–43%. At 1× the existing loop already
publishes 5 Hz, so full-view traffic stays the same and the keepalive adds 122–125 bytes/second
per guest (under 0.2% in these samples). Ordinary running publications halve relative to an ideal
10 Hz stream, but that is a rate comparison rather than a claim of 50% savings at every speed.

Deterministic tests additionally verify that ten seconds of unchanged paused polling creates no
views, rapid commands share a single clone batch and retain each sender's latest receipt, rejected
retries receive acknowledgements, and reconnects force a baseline. Worker/session/native tests
cover keepalives and authenticated membership; browser journeys cover more than five seconds
paused without a false warning and recovery after a deliberately interrupted host stream.

## Acknowledged checkpoint reuse

The host still persists every requested checkpoint. It now skips sending an identical checkpoint
to a connected peer only after that peer has acknowledged successfully writing that exact digest.
The proof belongs to the connection: a reconnect needs a complete copy, changed contents invalidate
the old proof, and an unacknowledged or failed send is retried on the next checkpoint. Only a receipt
for the current checkpoint queued on that connection counts. Repeated local saves do not advance
the displayed remote confirmation time without a new receipt. No delta format is introduced.

The native persistence guard now accepts the current world schema, version 2. Real filesystem tests
cover host and guest writes, overlapping checkpoints, failed guest writes and subsequent retry.
The bandwidth benchmark calls the native checkpoint, send and receive methods, then chunks and
reassembles the actual compressed payloads. It checks initial copies, unacknowledged retries, zero
bytes for acknowledged repeats, and a full copy after one peer reconnects. Disk writes are counted
but stubbed in that wire benchmark; filesystem behavior is tested separately. Its
`acknowledgedPausedWireBytesPerSecond` field compares successful complete-checkpoint transmission
with acknowledged reuse. The previous native schema-1 guard rejected schema-2 worlds, so the
comparison models the intended complete-checkpoint policy; it is not a claim about observed
deployed traffic. The older `cadence` fields retain the historical publication-rate comparison.

Windows x64, Node 24.14.0, real initialized worlds at months 0 and 48, decimal KB/s. These steady
paused rates include the existing 1 Hz keepalive after each guest has confirmed its copy; they
exclude initial copies, reconnects, changed contents and incoming guest traffic.

| Players | Month | Complete-checkpoint policy | Acknowledged reuse | Reduction |
| ------: | ----: | -------------------------: | -----------------: | --------: |
|       2 |     0 |                 4.555 KB/s |         0.122 KB/s |     97.3% |
|       2 |    48 |                10.433 KB/s |         0.125 KB/s |     98.8% |
|       4 |     0 |                26.253 KB/s |         0.366 KB/s |     98.6% |
|       4 |    48 |                61.498 KB/s |         0.375 KB/s |     99.4% |

Running-state complete-view payloads and changed-checkpoint traffic are unchanged by this step.

## Remaining opportunities in snapshot mode

- Completed history, current-month timeline rows and static portfolio/context data still travel
  in every changed view. Versioned blocks could reduce late-match bandwidth further, but require
  explicit per-recipient baselines, schema validation and reconnect recovery tests. Measure that
  separately before adding a delta protocol.
- Changed checkpoints still travel in full. Local checkpoint writes also remain in place, even
  when all guests have confirmed identical contents, to preserve each explicit save request's
  persistence and failure reporting.
- Views and changed checkpoints still serialize their JSON on the main process. Compression now
  runs asynchronously, and a peer keeps only one encoding plus its newest waiting view. A future
  worker codec could also move JSON serialization off the main process if measurements justify it.

No relay, cross-play transport or developer-operated server is introduced by this change.

## Controls under competing video load (November 2026)

Live-view and checkpoint deflate compression now use Node's asynchronous zlib API so Steam
callbacks and renderer requests can proceed during compression. Waiting views coalesce before
serialization; an encoding already in progress can finish, so sustained overload still makes
progress. Encoded unsent views retain the existing queue coalescing. Completions check connection
identity before enqueueing, including a reconnect with the same Steam ID. Compression errors still
reach the caller. Lobby and scenario-definition transitions also discard older pending encodes so
an old grid cannot reappear after returning to the lobby. The framing, compression settings, size
limits, numeric encoding and full-view protocol stay the same.

The renderer also stops reapplying an unchanged game on session-only notifications, including the
pending-command notification that runs before a command is transmitted. Ordinary cloned snapshots
retain the shared clock's object identity while its values agree, so the speed buttons do not
re-render on each five-Hz update. Changed player speeds, readiness and pause reasons still update.

A local Node 26.13.0 arm64 measurement alternated six synchronous/asynchronous pairs, each encoding
the same real 60-month grid payload three times. A queued event-loop callback ran after a median
11.65 ms with synchronous deflate and 2.53 ms with asynchronous deflate (78% less blockage). The
compressed payload was identical at 51,909 bytes. This isolates codec scheduling; it is not an
end-to-end latency or physical-device guarantee. JSON serialization still takes main-process time.

Native tests hold compression open while newer views and small messages arrive, verify bounded
coalescing, failure propagation and reconnect cleanup, and round-trip the asynchronous output
through the shipping decoder. Renderer tests protect the eliminated snapshot replays and clock
identity. The headless multiplayer journey runs at 12× with sixfold renderer CPU throttling and a
640×360, 30 fps local WebRTC stream, verifies that frames are actually encoded, and checks keyboard
and pointer speed changes on both peers after the first year. It uses synthetic local video;
real calls also depend on the device, call software and network.

## Replica determinism and hash capture (November 2026)

`src/multiplayer/Replication.sim.test.tsx` drives the real host recorder and replica reducer for
five game years with two and four companies in an official scenario, a custom game and the
checked-in funded-or-phased mod example. Replicas install shipping-codec baselines at launch,
mid-month, immediately before and after rollover, and after a scenario choice. Every verify
record compares the complete canonical world, including shell blockers and generator commitment
metadata. Record removal, duplication, reordering, alteration and missing baseline metadata are
negative controls. A prerequisite mutation proof restored the old fuel-history module global and
lost the expected spike in both a resumed solo game and later co-op companies.

Run the focused equivalence check with `npm run test:once -- Replication.sim.test --runInBand`.
`node scripts/ci/replication-transcript.js` also checks a committed bit-exact four-company
transcript through month 60. The Linux x64, Windows x64 and macOS arm64 packaging jobs run that
same transcript. Only its fixture build-compatibility label is pinned; production state hashes
retain the actual rules ID and all simulation values without rounding. Rewriting the transcript
requires an intentional simulation change and explanation; `--write` is the explicit authoring
command, not a recovery step for a failure.

`node scripts/perf/replica-hash.js` initializes and advances a four-company custom world to month
48, then measures synchronous canonical capture and asynchronous WebCrypto SHA-256 inside a Node
worker. It discards one warmup and reports the median of five samples. On macOS arm64, Node
26.13.0, Apple M5 Max, the canonical payload was 1,297,892 bytes; capture took 7.00 ms and SHA-256
0.48 ms. Peak process RSS was 531 MB, including fixture simulation and the worker; it is not an
isolated memory cost of hashing. These are local diagnostics, not a slow-device performance gate
or a claim about observed Steam traffic.

## Replica traffic, replay cost and default decision (November 2026)

Replication is opt-in at match start or restore with the host's hidden `?coopReplication=1`
flag. Snapshot mode remains the default and the fallback. A guest follows the first view or
baseline it receives for an epoch. Every peer still runs the same compatible build; the host
validates commands, orders all transitions and owns durable saves. No relay, prediction or host
migration is introduced.

Reproduce the complete report with Node 26 and the lockfile installation:

```sh
node scripts/perf/multiplayer-network.js > network-results.json
```

The existing snapshot payload and acknowledged-checkpoint fields remain in the report. Each
sample also measures a real one-second host record trace at 1×, 12× and 24× for two and four
companies, at months 0 and 48. It batches steps at 100 ms, captures one verify boundary, and
round-trips every payload through the shipping codec, including asynchronous reassembly. The
one-second trace is a virtual-time traffic model, not a timed Steam session. It does not add
purchases or grow the fleet. Steady upload includes records, a keepalive each second and one
complete durable checkpoint every ten seconds. Initial and recovery baselines are reported
separately as one-time wire bytes, rather than hidden in a steady-state rate.

Each trace runs the actual `ReplicaRuntime` in a separate Node worker, acknowledges view credit,
and asserts five local-seat view publications per virtual second. Its final canonical SHA-256
must equal the host's. Timings discard one warmup and use the median of three samples.
`replayCpuMs` counts the replay thread, local view projection and synchronous canonical capture.
Renderer reconciliation and cross-process view delivery are excluded. `processCpuMs` counts all process threads,
including SHA-256 and otherwise-idle parent or garbage-collector work; its one-core percentage is
therefore a conservative local diagnostic. Baseline hydration and TypeScript loading happen
before CPU timing. Heap peaks include the Node TypeScript loader, decoded baseline and setup;
peak RSS covers the whole process. These memory figures are not browser-worker footprint claims.

Command latency uses the real `ReplicaRuntime` and `ViewPublication` over an in-process mock
transport with the shipping codec. Both modes issue the same 24 rate changes; four warmups are
discarded and the remaining twenty form the 95th percentile. Snapshot views and baselines use
asynchronous compression. The replica consumes view credit after each delivered view. The
command stream is paused and network transit is zero; IPC, continuously ticking simulation,
competing video load and Steam are excluded. Use replication-mode browser journeys to cover UI
flows and competing load separately; this diagnostic cannot establish a slow-device service guarantee.

Recorded locally on macOS arm64, Node 26.13.0, Apple M5 Max, with decimal KB:
the four-company month-48 sample at 24× modeled 857.36 KB/s of snapshot host
upload versus 67.76 KB/s with records, a 92.10% reduction including durable checkpoints.
Per guest, records contributed 1.508 KB/s, checkpoints 20.954 KB/s and keepalives
0.123 KB/s. Each initial or recovery baseline cost another 209.49 KB per guest plus a small
verification batch. That one-time cost is excluded from the stated steady rate.

The same late-match sample used 1.30% at 1×, 2.42% at 12×, and 6.64% at 24× of one core when all process
threads were counted. At 24×, the replay thread itself used 4.29%, the three warmed wall-time
samples had a median of 44.48 ms per virtual second, and loader-inclusive peak worker heap was
170.8 MB (whole-process peak RSS 697.8 MB). Snapshot remote-seat projections cost a median
2.67 ms to clone and 10.70 ms to encode per publication; records encoded for all three
guests cost 0.47 ms per virtual second. New hash capture remains an additional host cost,
measured separately above. Compression timing uses the synchronous shipping encoder for CPU
comparison; native live-view compression already runs asynchronously.

The late-match mock command latency was 105.81 ms at the 95th percentile with snapshots and
102.77 ms with replication (-3.04 ms). All four two/four-company early/late samples stayed within
+50 ms in this local mock. These values are measurements of the documented mock, not Steam
latency or the minimum supported hardware.

The default stays **off**. Local bandwidth and command-latency measurements do not establish
sustained 24× replay at no more than half a core on the slowest reference device. A Node worker
on an Apple M5 Max is not that reference, and its loader-inclusive memory is not a packaged
browser measurement. Before changing the default, retain zero mismatches across equivalence,
recovery and replication-mode browser suites, repeat the replay measurement on the recorded
slowest reference device, and require the issue's 80% upload and +50 ms mock-latency gates.
Snapshot mode must remain available for one release after any default change.
