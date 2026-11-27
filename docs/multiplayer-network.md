# Online replication and measurements

Online co-op uses ordered records and complete baselines for every match and restored game.
The host validates commands, orders simulation transitions and owns durable saves. Its worker
projects the host's local seat; each guest replays the ordered stream in its own worker and
projects its own seat. Couch co-op continues to project all local seats from its shared worker.
Every peer runs the same compatible build. No relay, prediction or host migration is introduced.

A guest installs a complete baseline before applying records. Verification records compare its
canonical world hash with the host's, and recovery installs a fresh baseline after a gap, mismatch
or reconnect. Baselines and durable save checkpoints contain complete worlds for their respective
recovery and persistence purposes.

Local view publication suppresses unchanged state and coalesces changes before cloning a grid.
Ordinary updates are bounded to 5 Hz. If an online renderer takes most of that interval to apply
a grid, the worker leaves time for input before sending the next ordinary update. Command and
readiness changes retain their 100 ms publication bound.
Bootstrap and recovery force an immediate local view. One outstanding view waits for renderer
credit before another is delivered. Command receipts, pending commands and errors remain part of
the session flow.

A 1 Hz host keepalive carries only match, epoch and revision. Guests accept it only from their
authenticated current host, for the installed match/epoch and a safe non-stale revision. It updates
connection liveness without replacing a view, clearing pending commands or dismissing command/save
errors. Guest heartbeats, five-second safety deadlines, ordered command retries, native
backpressure and complete ten-second checkpoint persistence remain in place. Guest heartbeats
also preserve liveness while a baseline is still loading.

## Reproduce

Use Node 26 with the lockfile dependencies installed:

```sh
node scripts/perf/multiplayer-network.js > network-results.json
```

The benchmark initializes real two- and four-company San Francisco custom worlds, then advances
the normal simulation to month 48 without purchasing additional facilities. It measures only
the shipping records, baseline, keepalive and checkpoint protocol. Every payload round-trips
through the shipping stringify/deflate/chunk/reassembly codec, including asynchronous reassembly,
and must retain the same contents. Each codec measurement discards a warmup and reports the
median of three runs. Wire bytes include application chunk headers, compression and checksum
framing, and exclude Steam/IP overhead.

Each sample records one virtual second of real host transitions at 1×, 12× and 24×, batching
steps at 100 ms and capturing a verification boundary. Steady upload includes records, one
keepalive per second and one complete durable checkpoint every ten seconds. Initial and recovery
baselines are reported separately as one-time wire bytes. These rates model payload traffic;
they do not time a Steam session or claim observed network throughput.

The report includes host-local projection CPU, checkpoint codec timings and actual native
checkpoint send/receipt behavior. `replication.speeds` contains startup baseline and verification
bytes, steady per-guest traffic by message purpose, total host egress and record encoding CPU.
The codec CPU measurements use the synchronous encoder; native baseline and checkpoint
compression use asynchronous zlib to keep the main-process callback pump available.

## Guest replay and command latency

Each trace runs the actual `ReplicaRuntime` in a separate Node worker and acknowledges view
credit. Every publication must contain only the guest's local seat, there must be five local
views per virtual second, and the final canonical SHA-256 must equal the host's. Replay timings
discard one warmup and use the median of three samples.

`replayCpuMs` counts the replay thread, local view projection and synchronous canonical capture.
Renderer reconciliation and cross-process view delivery are excluded. `processCpuMs` counts all
process threads, including SHA-256 and otherwise-idle parent or garbage-collector work; its
one-core percentage is a conservative local diagnostic. Baseline hydration and TypeScript loading
happen before CPU timing. Heap peaks include the Node TypeScript loader, decoded baseline and
setup; peak RSS covers the whole process. These memory figures describe the benchmark process.

`replication.commandLatency.p95Ms` reports absolute command-to-local-view latency over an
in-process mock transport. The host accepts 24 rate changes; four warmups are discarded and the
remaining twenty form the 95th percentile. The baseline uses asynchronous compression, records
pass through the shipping codec, and the actual `ReplicaRuntime` and `ViewPublication` deliver
and acknowledge local views. The command stream is paused and network transit is zero. IPC,
continuously ticking simulation, competing video load and Steam are excluded.

Run the ordinary headless multiplayer journeys with no mode flag:

```sh
npm run test:multiplayer
```

Those journeys cover gameplay, recovery, reconnects and controls under competing video load.
The load case runs at 12× with sixfold renderer CPU throttling and a 640×360, 30 fps local WebRTC
stream. It verifies that frames are encoded and checks keyboard and pointer speed changes on
both peers after the first year. Synthetic local video and the Node mock measure separate parts
of the system; real calls also depend on the device, call software and network.

## Acknowledged checkpoint reuse

The host persists every requested checkpoint. For each guest, it finishes transfers whose first
frames have been sent, reuses an identical copy still in the send queue, and replaces an unsent
copy with the latest checkpoint from the same campaign. Saves for distinct campaigns keep their
order in the queue. A repeated checkpoint can retry a completed transfer if the guest has yet to
acknowledge writing that digest. The proof belongs to the connection, so a
reconnect needs a complete copy and queueing changed contents invalidates the old proof. Only a
receipt for the current checkpoint queued on that connection advances the displayed remote
confirmation time.

While a guest writes a checkpoint, it retains the latest waiting checkpoint for each of the two
most recently received campaigns. A new campaign arriving at capacity evicts the oldest waiting
checkpoint without a receipt. This lets the host's final checkpoint reach disk while bounding
memory during a storage stall. Ordered records continue to arrive while the disk write is pending.

The benchmark calls native checkpoint, send and receive methods, then chunks and reassembles the
actual compressed payloads. It checks initial copies, unacknowledged retries, zero bytes for
acknowledged repeats and a full copy after one peer reconnects. Disk writes are counted and stubbed
in the wire benchmark. Filesystem tests separately cover host and guest writes, overlapping
checkpoints, failed guest writes and subsequent retry.

`checkpointPublications` reports those actual message sizes and the four local write requests.
`acknowledgedPausedHostWireBytesPerSecond` reports steady host keepalive traffic after every guest
has confirmed its unchanged checkpoint. Initial copies, reconnects, changed contents, incoming
guest heartbeats and small save acknowledgements are excluded from that paused rate.

## Determinism and hash capture

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
command.

`node scripts/perf/replica-hash.js` initializes and advances a four-company custom world to month
48, then measures synchronous canonical capture and asynchronous WebCrypto SHA-256 inside a Node
worker. It discards one warmup and reports the median of five samples.

## Historical measurements (November 2026)

These recorded local results describe the hardware and benchmark version used at the time. The
current benchmark measures the shipping record stream directly; it contains no snapshot-view
runtime or comparison path.

On macOS arm64, Node 26.13.0, Apple M5 Max, the four-company month-48 sample at 24× modeled
67.76 KB/s of record-stream host upload, including durable checkpoints. The earlier snapshot
comparison modeled 857.36 KB/s, giving a 92.10% reduction in that model. Per guest, records
contributed 1.508 KB/s, checkpoints 20.954 KB/s and keepalives 0.123 KB/s. Each initial or recovery
baseline cost another 209.49 KB per guest plus a small verification batch. All sizes use decimal KB.

That sample used 1.30% at 1×, 2.42% at 12× and 6.64% at 24× of one core when all process threads
were counted. At 24×, the replay thread used 4.29%, warmed wall time had a median of 44.48 ms per
virtual second, and loader-inclusive peak worker heap was 170.8 MB with whole-process peak RSS
697.8 MB. Records encoded for all three guests cost 0.47 ms per virtual second. The local command
mock measured an absolute p95 of 102.77 ms for the record path. The earlier snapshot comparison
measured 105.81 ms. These are diagnostics for the documented mock and hardware.

The separate hash benchmark on that machine measured a canonical payload of 1,297,892 bytes,
7.00 ms capture and 0.48 ms SHA-256. Peak process RSS was 531 MB, including fixture simulation
and the worker.

An earlier Node 26.13.0 arm64 codec experiment alternated six synchronous/asynchronous pairs,
encoding the same real 60-month grid payload three times per pair. A queued event-loop callback
ran after a median 11.65 ms with synchronous deflate and 2.53 ms with asynchronous deflate
(78% less blockage). The compressed payload was identical at 51,909 bytes. This isolated codec
scheduling; JSON serialization still takes main-process time.

Earlier Windows x64, Node 24.14.0 checkpoint measurements modeled four-company month-48 paused
host upload at 61.498 KB/s with complete-checkpoint sends and 0.375 KB/s after acknowledged reuse.
The complete-checkpoint figure modeled the intended policy: the native schema-1 guard then
rejected schema-2 worlds, so it was not observed deployed traffic.

## TURN qualification for cross-play

Issue [#546](https://github.com/toddmedema/electrify/issues/546) calls for authenticated
private rooms shared by web and Steam. The session accepts a room transport and a
checkpoint store separately. The Steam adapter still delegates checkpoint writes to the
native operation that also distributes offline copies and publishes save confirmations.

A local baseline for the four-company, month-48 benchmark on an Apple M5 Max with Node
26.13.0 measured about 205 KiB for an initial baseline per guest, 3.1 ms per host view
publication, and 58 ms of guest replay-thread CPU per virtual second at 24×. The total host
application traffic at 24× was about 66 KiB/s across three guests, including about 61 KiB/s
of checkpoint traffic when all three received a full checkpoint every ten seconds. The
in-process command-to-view sample measured 100 ms p95. The numbers exclude real network
latency and protocol overhead. They are a comparison point for the HTTPS checkpoint and
WebRTC record paths in #546.

The opt-in probe uses a dedicated Cloudflare Realtime TURN key. Store its ID and API token
as `CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_KEY_API_TOKEN` in a private local environment
file and run:

```sh
node --env-file=/path/to/private-turn.env scripts/testing/cloudflare-turn.js
```

It uses four isolated browser contexts, with the first acting as host to three concurrent
guests. The last guest delays receipts by 1.2 seconds. Each pair uses short-lived credentials,
separate UDP and TLS-on-443 runs, and a new connection with fresh credentials after
revocation. Each selected pair must match its exchanged relay endpoints. The probe
removes related addresses and ports from the generated descriptions before exchanging
them. Reports show setup and receipt times, ICE-pair byte counters, any available local
relay protocol, and guest deliveries and returned receipts observed after revocation. The runner revokes outstanding test
credentials on completion, interruption, and handled failures.
Set `ELECTRIFY_TURN_BROWSERS=chromium,chromium,firefox,webkit` to use additional installed
Playwright engines. The first entry hosts.

A live test with each of Chromium, Firefox and WebKit hosting passed all 18 pair runs over
Cloudflare, including the replacement connections. WebKit exposed the selected relay
addresses and candidate types, with no local relay-protocol statistic. A separate TLS
run routed the last guest's encrypted TURN connection through a loopback TCP proxy
capped at 128 KiB/s in each direction with 45 ms minimum delay per chunk. Its burst
returned eight receipts in 2.8 seconds, including the 1.2-second application delay.

A Chromium in-place ICE restart with new credentials kept selecting its old relay
endpoints throughout a ten-second observation despite exchanging fresh candidates.
Use full connection replacement to qualify credential rotation. One TURN credential
also authorized concurrent allocations on both sides of each test pair. All three
UDP pairs still delivered eight messages and eight receipts in a burst sent 30 seconds
after Cloudflare confirmed revocation. In a separate run with a 60-second credential
TTL, all three pairs still delivered a burst sent 66 seconds after the initial exchange.
If the rollout relies on the emergency stop to cap spend, measure how long
existing allocations continue to carry traffic after the stop.

The probe runs synthetic traffic with in-process signaling. Its delayed receipts measure
one slow application participant. Deployed signaling, actual gameplay, native Steam,
packet-level egress and provider billing require separate tests.
The TLS run configures only TLS on port 443. With UDP blocked at the network boundary,
set `ELECTRIFY_TURN_TRANSPORT=tls` to run that case in isolation. The diagnostic checks
candidate types and public addresses, as does production signaling. If the TURN
provider supplies allocation ranges, the probe can also check them using
`COOP_TURN_RELAY_CIDRS` in its local environment. Cloudflare documents TURN listeners,
per-allocation limits and credential revocation.
[Cloudflare TURN FAQ](https://developers.cloudflare.com/realtime/turn/faq/) ·
[Service limits](https://developers.cloudflare.com/realtime/turn/#limits) ·
[Credential revocation](https://developers.cloudflare.com/realtime/turn/generate-credentials/#revoke-credentials)
