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

Use Node 24 with the lockfile dependencies installed:

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

## Remaining opportunities

- Completed history, current-month timeline rows and static portfolio/context data still travel
  in every changed view. Versioned blocks could reduce late-match bandwidth further, but require
  explicit per-recipient baselines, schema validation and reconnect recovery tests. Measure that
  separately before adding a delta protocol.
- Changed checkpoints still travel in full. Local checkpoint writes also remain in place, even
  when all guests have confirmed identical contents, to preserve each explicit save request's
  persistence and failure reporting.
- Native send queues coalesce unsent views after encoding. A slow network can therefore still pay
  for encoding a replaced frame. Moving that work behind a bounded queue is a possible later CPU
  improvement if real transport measurements justify it.

No relay, cross-play transport or developer-operated server is introduced by this change.
