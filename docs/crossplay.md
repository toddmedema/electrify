# Web and Steam cross-play

Open **Play with friends** to host or join a private game for two to four players.
The website uses Google sign-in and the Steam edition uses your signed-in Steam
account. Hosting opens the custom game editor. Share the invite link or
six-character code so friends can join directly. The host can remove a player
before the game starts. Each player keeps their company for the campaign.
After hosting, existing campaigns can be resumed with **Load multiplayer save**.

New campaigns put all companies on the same 3D regional map. Each company
starts at its own headquarters with land for its opening fleet. Claim neutral
land next to your existing property to open more build sites. You can inspect
other companies' property and plants on the map. Once two companies share a
border, both must approve and fund an intertie. After construction, the link
carries trades according to each company's buying and selling policies and
its available capacity.

Any player can host. The host's device runs the simulation and each guest's
device replays the records to produce its own views. Backgrounding or losing a
required device pauses play. If the host lease expires, an original player can
reconnect to acquire it and resume from the last confirmed online save. Progress
since that save can be lost. **Save & Quit** asks the host for a fresh confirmed
save and pauses the campaign until the original players return.

Private co-op is unranked. Joined players receive the entire world and can keep
an offline copy after leaving. The host can change or stall the simulation.
Google and Steam provide identity to the service. Other players see an opaque
seat ID and your display name. The service handles room and connection metadata.
Cloudflare sees relay network metadata including client IPs and traffic volume.
WebRTC DTLS encrypts gameplay traffic in transit.

## Service contract

The managed Functions runtime buffers request bodies before the handler applies its
128 KiB limit for ordinary JSON and 8 MiB + 4 KiB limit for bulk requests. The published second-generation HTTP limit is
32 MB uncompressed. Per-client quotas use the address the Cloud Run front end
appends to `X-Forwarded-For`. Earlier entries are caller-supplied and are ignored.
`COOP_TRUSTED_PROXY_HOPS` skips additional proxies operated in front of that
front end. When the header is absent, the quota uses the socket address.
[Functions limits](https://docs.cloud.google.com/functions/quotas)
· [Request headers](https://docs.cloud.google.com/functions/docs/reference/headers)

The browser posts authenticated JSON to the fixed `coopV2` HTTPS function. Steam
requests go through Electron main. Steam tickets and temporary service tokens
stay in main. The renderer receives validated responses and temporary TURN
credentials. Invite landing pages permit only the first-party fragment route and
a configured Steam App ID. The launch argument opens a prompt.

Firebase verifies Google accounts and Valve verifies Steam ticket proofs. A
bearer expires in five minutes. Each account has one active device binding.
Seats and invites belong to a room. Invite links contain 128 bits of randomness.
Invite codes use six lowercase letters or digits. Both expire after 15 minutes.
Joining requires a valid invite and an authenticated account. Once locked, a
room cannot add a different account.

Firestore stores the roster, lease, epoch, and checkpoint manifests. The
12-second lease renews using a write-time expiry guard. A verified relay stays
up until that lease ends or the epoch changes. A room response older than four
seconds does not extend the lease. Hiding the tab stops renewal without
closing the relay. A lost peer connection clears the descriptions and reuses
that generation's TURN credential while more than 20 seconds remain. Replacing
a live credential still waits for the rotation cooldown. An active host and
guest bind authenticated SDP to a connection generation and both verify the
selected candidate pair as relay–relay. Before TURN credentials expire, the
pair prepares a verified successor and drains ordered gameplay traffic before
moving it to the new channel. Credentials last 140 seconds, including 20
seconds of grace after the previous renewal point, and both peers can promote
the successor once the drain is acknowledged. A provider HTTP refusal releases
its grant reservation. A timeout keeps the reservation because the credential
may already exist. TURN permits UDP and TLS over
port 443. HTTPS handles large replication baselines, scenario snapshots and
checkpoints. Checkpoints are pinned to an immutable Cloud Storage generation
and checked against the room epoch, roster, compatibility ID and head.
Each account has six ordinary checkpoint upload attempts per minute and a
separate allowance of two attempts to publish a recovered epoch. A returning
host can use recovery after exhausting ordinary uploads. Each room has six
attempts per 60-second window plus two reserved for recovery. Host handoffs
share that room budget for the rest of its window. Attempts that reach payload
validation consume the budget even if validation fails.

## Web-only production rollout

Use `https://electrifygame.com` and leave the Actions variable `STEAM_APP_ID`
unset. Firebase deploys co-op with the four web/TURN secrets. Any player who
signs in with Google can host. Joining a private lobby requires its invite.
The deployment checks co-op health before publishing the
website. The operator can stop the service with `coopSettings/runtime.stopped`
in Firestore.

Signaling accepts canonical data-only descriptions. Browsers strip attributes
outside that description before sending. Relay candidates must be public IPv4
or IPv6 addresses. Direct candidates and private or reserved addresses are
rejected. When `COOP_TURN_RELAY_CIDRS` lists the provider's allocation ranges,
candidates outside those ranges are rejected too. An invalid list prevents the
function from starting. Without that list, a player can still supply a public
destination and cause TURN to send connectivity checks there, so admission
stays at two rooms until the ranges are configured.

After deployment, use two signed-in browsers to verify direct join by link and
code, play through three credential renewals, Save & Quit, and recovery under a
different host. Send gameplay commands across each renewal and check that the
game keeps running without a reconnect dialog. Verify the selected TURN relay
path on a normal connection and over TLS with UDP blocked.

## Release access

Provision the web deployment resources through the provider consoles and keep
tokens and keys in the named secret stores. Share the project ID, endpoint, bucket
name, and test results in the PR. Include the Steam App ID and Steamworks setup
when qualifying the combined web and Steam release.

- **GitHub repository maintainer.** Set `COOP_CHECKPOINT_BUCKET` as an Actions
  variable on the repository or its `production` environment. Add `STEAM_APP_ID`
  when Steam is ready. The production preflight validates these settings before
  Firebase changes. The existing
  `FIREBASE_SERVICE_ACCOUNT` deploy identity needs permission to deploy
  Firestore rules and indexes, the two co-op functions and their scheduler,
  and to act as the runtime service account. The workflow deploys Firebase
  and checks its health before publishing the AWS web bundle.
- **Steamworks administrator and build operator for the combined release.** Confirm the production App
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
  Accessor on the four web/TURN secrets, and grant access to the publisher
  key when adding Steam. Create `COOP_FIREBASE_WRITER_API_KEY`
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
  `CLOUDFLARE_TURN_KEY_API_TOKEN`. For broader rollout, document applicable
  destination rules, enforceable account-level or key-level limits, and access
  to usage measurements. If approval relies on shutdown,
  obtain the cutoff and billing behavior for already allocated relays and
  demonstrate a maximum time and outbound byte count after the stop. The
  service admits two live rooms and tracks up to 120 grants, with at most
  60 per room and 20 per host/guest pair. Reservations remain counted for a
  ten-minute drain after credential expiry. One grant can authorize multiple allocations, so
  use provider enforcement or a measured cutoff to establish the aggregate
  exposure. [Credential operations](https://developers.cloudflare.com/realtime/turn/generate-credentials/)
  · [Per-allocation limits](https://developers.cloudflare.com/realtime/turn/#limits)
  · [Allocation expiry and billing](https://developers.cloudflare.com/realtime/turn/faq/#what-will-happen-if-turn-credentials-expire-while-the-turn-allocation-is-in-use)

For a separate staging deployment, provide the HTTPS origin, Firebase project
and web app configuration, Steam App ID and test depot, and checkpoint bucket.
The checked-in browser and Steam build target the
production function, Firebase project, and Steam ticket audience. A separate
deployment needs the matching endpoint, auth audience, runtime service account,
and invite settings wired into its build before end-to-end testing. Protect that
deployment and its Steam build for the approved test group.

## Combined web and Steam live acceptance

Arrange four devices with distinct co-op identities and access to the same test
build. Use Google test accounts on iPhone Safari, Android Chrome, and desktop
web, and an entitled account in the live Steam client on the fourth device.
Have an operator who can block UDP for those devices while leaving HTTPS and
TURN over TLS on TCP 443 available. Have a Cloudflare usage observer and a
Firebase operator who can toggle `coopSettings/runtime.stopped` on the test
deployment and inspect aggregate logs.

1. Over an ordinary network, rotate hosting through each of the four devices.
   Join by code and link, including **Open in Steam** with the game closed and
   already running. Verify direct join and play through a late checkpoint.
   Record the selected relay-to-relay path on the host and all three guests.
   Repeat on the UDP-blocked network and confirm the selected TCP 443 TLS path.
2. On the same locked roster, background and reconnect a required mobile
   device, change networks, replace an account session, and expire the host
   lease. Compete for takeover and recover from the confirmed checkpoint.
   Exercise Save & Quit, returning to the game, and denying access to outsiders and displaced sessions. Verify the campaign
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
test key. Run the four-device matrix against the deployed stack for combined web
and Steam release acceptance.

Relay cost estimates and application bounds are distinct. At the historical
5 MiB live-payload measurement and a rate of $0.05 per GB, the payload alone
would cost approximately $0.00026 for that session. Actual egress, relay overhead,
large transfers, backend writes and abuse exposure need live measurement.

Provider references are available in [the issue](https://github.com/toddmedema/electrify/issues/546)
and the [Cloudflare TURN documentation](https://developers.cloudflare.com/realtime/turn/).
