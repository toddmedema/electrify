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

## Release access

Provision these resources through the provider consoles before a production
rollout. Keep tokens and keys in the named secret stores. Share the project ID,
App ID, endpoint, bucket name, provider policy and pass/fail evidence in the PR.

- **GitHub repository maintainer.** Set Actions variables `STEAM_APP_ID`,
  `COOP_CHECKPOINT_BUCKET` and `COOP_TURN_RELAY_CIDRS` on the repository or
  its `production` environment. Use the public IPv4 networks Cloudflare
  confirms for **relay allocations**. The preflight validates the same CIDR
  syntax as the application. It runs before Firebase changes. The existing
  `FIREBASE_SERVICE_ACCOUNT` deploy identity needs permission to deploy
  Firestore rules and indexes, the two co-op functions and their scheduler,
  and to act as the runtime service account. The workflow deploys Firebase
  and checks its health before publishing the AWS web bundle.
- **Steamworks administrator and build operator.** Confirm the production App
  ID and enable **Use launch command line**. Have a Steamworks administrator
  create a publisher Web API key for the group containing Electrify and put it
  in Secret Manager as `STEAM_PUBLISHER_KEY`. Use the dedicated build account
  with **Edit App Metadata** and **Publish App Changes To Steam** for the
  protected beta build. Give the Steam tester an account entitled to the game
  and access to that branch. The web bundle and Steam depot must use the same
  compatibility version. [Ticket verification](https://partner.steamgames.com/doc/webapi/isteamuserauth)
  · [Build permissions](https://partner.steamgames.com/doc/sdk/uploading)
  · [Beta branches](https://partner.steamgames.com/doc/store/application/builds)
- **Firebase and Google Cloud administrator.** Enable Google sign-in for the
  approved test web origin. Create `coop-service@electrify-game.iam.gserviceaccount.com`.
  Give it Firebase Auth user lookup for revocation checks (`firebaseauth.users.get`),
  Firestore data read/write, and `iam.serviceAccounts.signBlob` on the account
  used to sign the Firebase writer token. Give it Secret Manager Secret
  Accessor on the five co-op secrets. Create `COOP_FIREBASE_WRITER_API_KEY`
  in the Firebase project for the server-side Identity Toolkit token exchange
  and `COOP_RATE_LIMIT_KEY` from at least 32 random bytes. Grant bucket metadata
  read and object create, get, list and delete on the dedicated checkpoint
  bucket. Enable uniform bucket-level access and enforce public access
  prevention on that bucket. Confirm player identities have no direct bucket
  access and check its lifecycle and soft-delete settings against retention.
  [Firebase Auth permissions](https://firebase.google.com/docs/projects/iam/roles-predefined-product#firebase_authentication_roles)
  · [Writer signing](https://firebase.google.com/docs/auth/admin/create-custom-tokens)
  · [Storage permissions](https://docs.cloud.google.com/storage/docs/access-control/iam-permissions)
- **Cloudflare Realtime account owner or delegated operator.** Provision a
  dedicated test TURN key and a separate production key. Store the production
  key ID and token in Secret Manager as `CLOUDFLARE_TURN_KEY_ID` and
  `CLOUDFLARE_TURN_KEY_API_TOKEN`. Provide the provider-confirmed allocation
  CIDRs, applicable destination rules, enforceable account-level or key-level
  limits and access to usage measurements. If approval relies on shutdown,
  obtain the cutoff and billing behavior for already allocated relays and
  demonstrate a maximum time and outbound byte count after the stop. The
  service admits two live rooms and limits issuance to 120 tracked grants with
  a ten-minute drain period. One grant can authorize multiple allocations, so
  use provider enforcement or a measured cutoff to establish the aggregate
  exposure. [Credential operations](https://developers.cloudflare.com/realtime/turn/generate-credentials/)
  · [Per-allocation limits](https://developers.cloudflare.com/realtime/turn/#limits)
  · [Allocation expiry and billing](https://developers.cloudflare.com/realtime/turn/faq/#what-will-happen-if-turn-credentials-expire-while-the-turn-allocation-is-in-use)

For a separate staging deployment, provide the HTTPS origin, Firebase project
and web app configuration, Steam App ID and test depot, checkpoint bucket, and
provider allocation CIDRs. The checked-in browser and Steam build target the
production function, Firebase project, and Steam ticket audience. A separate
deployment needs the matching endpoint, auth audience, runtime service account,
and invite settings wired into its build before end-to-end testing. Protect that
deployment and its Steam build for the approved test group.

## Live acceptance

Arrange four devices with distinct co-op identities and access to the same test
build. Use Google test accounts on iPhone Safari, Android Chrome, and desktop
web, and an entitled account in the live Steam client on the fourth device.
Have an operator who can block UDP for those devices while leaving HTTPS and
TURN over TLS on TCP 443 available. Have a Cloudflare usage observer and a
Firebase operator who can toggle `coopSettings/runtime.stopped` on the test
deployment and inspect aggregate logs.

1. Over an ordinary network, rotate hosting through each of the four devices.
   Join by code and link, including **Open in Steam** with the game closed and
   already running. Confirm host approval and play through a late checkpoint.
   Record the selected relay-to-relay path on the host and all three guests.
   Repeat on the UDP-blocked network and confirm the selected TCP 443 TLS path.
2. On the same locked roster, background and reconnect a required mobile
   device, change networks, replace an account session, and expire the host
   lease. Compete for takeover and recover from the confirmed checkpoint.
   Exercise Save & Quit, returning to the game, downloading a permitted save,
   and denying access to outsiders and displaced sessions. Verify the campaign
   remains unranked.
3. Exercise malformed and oversized input and exhaust the room and grant
   quotas in the protected deployment. Measure late-game command latency,
   relay and checkpoint bytes, control service calls and client memory.
   Inspect the service logs for credential, invite, SDP and player-data redaction.
4. Drill the emergency stop while a room is active and a checkpoint transfer
   is in flight. Record when room admission and grants stop, when active
   credentials are revoked, when transfers end, and when already allocated
   provider relays stop sending and billing traffic. Use the provider usage
   record to check the aggregate exposure before widening admission.

Record the commit and compatibility ID, OS/browser/Steam versions, host order,
transports, measured limits and pass/fail for each case. The repository's
[TURN probe](multiplayer-network.md#turn-qualification-for-cross-play) can measure
synthetic browser relay paths and traffic after revocation using a dedicated
test key. Supply the provider-confirmed `COOP_TURN_RELAY_CIDRS` to check
each observed candidate against the production policy. Preserve the report's
`allocationCidrsChecked` result with the measured traffic. Run the four-device
matrix against the deployed stack for release acceptance.

Relay cost estimates and application bounds are distinct. At the historical
5 MiB live-payload measurement and a rate of $0.05 per GB, the payload alone
would cost approximately $0.00026 for that session. Actual egress, relay overhead,
large transfers, backend writes and abuse exposure need live measurement.

Provider references are available in [the issue](https://github.com/toddmedema/electrify/issues/546)
and the [Cloudflare TURN documentation](https://developers.cloudflare.com/realtime/turn/).
