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

## Remaining opportunities

- Completed history, current-month timeline rows and static portfolio/context data still travel
  in every changed view. Versioned blocks could reduce late-match bandwidth further, but require
  explicit per-recipient baselines, schema validation and reconnect recovery tests. Measure that
  separately before adding a delta protocol.
- Complete checkpoints dominate the remaining paused traffic. Suppressing duplicate checkpoint
  writes requires acknowledging successful persistence and retaining failed-write/guest retry
  behavior; merely skipping unchanged worker revisions would lose those guarantees.
- Native send queues coalesce unsent views after encoding. A slow network can therefore still pay
  for encoding a replaced frame. Moving that work behind a bounded queue is a possible later CPU
  improvement if real transport measurements justify it.

No relay, cross-play transport or developer-operated server is introduced by this change.
