# Web and Steam cross-play

Open **Play with friends** to host or join a private game for two to four players.
The website uses Google sign-in and the Steam edition uses your signed-in Steam
account. Share the lobby's invite link or code. The host approves requests before
the game starts. Each approved account keeps its company for the campaign.

Any player can host. The host's device runs the simulation and each guest's
device replays the records to produce its own views. Backgrounding or losing a
required device pauses play. If the host lease expires, an original player can
reconnect to acquire it and resume from the last confirmed online save. Progress
since that save can be lost. **Save & Quit** asks the host for a fresh confirmed
save and pauses the campaign until the original players return.

Private co-op is unranked. Approved players receive the entire world and can keep
an offline copy after leaving. The host can change or stall the simulation.
Google and Steam provide identity to the service. Other players see an opaque
seat ID and your display name. The service handles room and connection metadata.
Cloudflare sees relay network metadata including client IPs and traffic volume.
WebRTC DTLS encrypts gameplay traffic in transit.

## Service contract

The browser posts authenticated JSON to the fixed `coopV2` HTTPS function. Steam
requests go through Electron main. Steam tickets and temporary service tokens
stay in main. The renderer receives validated responses and temporary TURN
credentials. Invite landing pages permit only the first-party fragment route and
a configured Steam App ID. The launch argument opens a prompt.

Firebase verifies Google accounts and Valve verifies Steam ticket proofs. A
bearer expires in five minutes. Each account has one active device binding.
Seats and invites belong to a room. Invite links contain 128 bits and invite
codes contain 80 bits of randomness, expire after 15 minutes, and request
approval. The host can replace an invite. Once locked, a room cannot add a
different account.

Firestore stores the roster, lease, epoch, and checkpoint manifests. The
12-second lease renews using a write-time expiry guard. A client accepts
authority grants for at most four seconds from its request start. An active
host and guest use authenticated SDP bound to one generation and must both
verify the selected candidate pair as relay–relay. TURN permits UDP and TLS over
port 443. HTTPS handles large replication baselines, scenario snapshots and
checkpoints. Checkpoints are pinned to an immutable Cloud Storage generation
and checked against the room epoch, roster, compatibility ID and head.

## Production prerequisites and release acceptance

Provision the following before merging a production rollout. The deployment
workflow publishes the control service and Firestore rules before the web
bundle. The same compatible build must ship to the Steam depot.

- Set the repository variables `STEAM_APP_ID`, `COOP_CHECKPOINT_BUCKET`, and
  `COOP_TURN_RELAY_CIDRS`. Use provider-confirmed **allocation** CIDRs. The TURN
  service's ingress A records describe a different network path. Enable Steamworks
  **Use launch command line** for the production App ID.
- In Google Secret Manager provision `STEAM_PUBLISHER_KEY`,
  `COOP_FIREBASE_WRITER_API_KEY`, `COOP_RATE_LIMIT_KEY`,
  `CLOUDFLARE_TURN_KEY_ID`, and `CLOUDFLARE_TURN_KEY_API_TOKEN`. Keep staging
  and production provider keys separate.
- Bind the functions to
  `coop-service@electrify-game.iam.gserviceaccount.com`. Grant the narrow IAM
  access needed for verified Firebase sessions, Firestore, the dedicated co-op
  writer token, the five specified secrets and the private bucket. Prevent
  public access on the bucket, use uniform bucket-level access, and verify the
  Firebase player identities cannot list or read objects. Review staging
  lifecycle and soft deletion together with the final retention period.
- Obtain provider-backed limits or prove that shutdown bounds outstanding TURN
  allocations. The service admits two live rooms and limits application-issued grants to 120
  with a ten-minute drain period. The conservative room cap reserves space for
  routine credential rotation. Cloudflare's published limits are per allocation. One grant can
  allow separate allocations, and traffic on a live allocation has continued
  after revocation or the nominal credential expiry in diagnostics. The
  grant limit alone cannot establish a maximum billed spend. For shutdown,
  set `coopSettings/runtime.stopped` and verify new requests stop, the reaper
  revokes issued keys, in-progress downloads end and existing relay traffic
  stops within the agreed time and byte limits.
- Run a four-player production-equivalent session rotating host across iPhone
  Safari, Android Chrome, desktop web and packaged Steam. Repeat with UDP
  blocked to prove the TLS/443 path. Measure late-game traffic, checkpoint
  transfers, control latency, service calls and peak memory. Verify account
  replacement, mobile backgrounding, network changes, fixed-roster gameplay,
  recovery, save access, quota exhaustion and the shutdown drill. Inspect
  access logs and traces for credentials, invite secrets and simulation data.

Relay cost estimates and application bounds are distinct. At the historical
5 MiB live-payload measurement and a rate of $0.05 per GB, the payload alone
would cost approximately $0.00026 for that session. Actual egress, relay overhead,
large transfers, backend writes and abuse exposure need live measurement.

Provider references are available in [the issue](https://github.com/toddmedema/electrify/issues/546)
and the [Cloudflare TURN documentation](https://developers.cloudflare.com/realtime/turn/).
