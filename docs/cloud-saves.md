# Cloud saves and share links

IndexedDB remains the source for loading and saving games. After Google sign-in, the
app backs up device saves to `users/{uid}/cloudSaves/{id}` and restores missing or
newer backups to IndexedDB. Automatic sync attempts are spaced at least five minutes
apart. After a game's first backup, automatic uploads require both five wall-clock
minutes and a full in-game year since its last upload. The checkpoint persists across
reloads and tabs. Explicit save interactions (including Save & Quit and Share) bypass
that cadence. No game waits for Firebase to load or save locally. Signed-out players
see the optional sign-in invitation only after their first successful Save & Quit.

Each backup has an opaque version checked in a Firestore transaction. Concurrent
offline edits keep both copies; an active local writer is never replaced. Local
deletion queues a durable outbox entry in the same IndexedDB transaction. Cloud
deletions retain a tombstone so other devices do not resurrect an old backup.
An edit made after the version being deleted is retained. Saves bind to one account;
switching accounts does not upload the first account's saves to the second.

Share links require sign-in to create and no account to open. They use ten random
base62 characters, retry collisions and store independent immutable payloads. Opening
a link first shows a preview; Play creates a new device save and opens playable games,
saving any current run before switching. Finished, unplayable runs open in the save
library. Saves keep the existing domain and result validation.
Payloads use the existing compact lossless encoding, split across documents to stay
below Firestore's 1 MiB document limit. The total limit is 8 MiB per save.

## Rollout

Before deploying the client, run `firebase deploy --only firestore` against
`electrify-game`. The existing production workflow runs this before deploying the client.
This deploys owner-only backup rules and enables the two TTL policies
in `firebase/firestore.indexes.json`. Verify both `sharedGames.expiresAt` and
`saveBlobs.expiresAt` show an active TTL policy in the Firebase/Google Cloud console.
TTL requires billing and enabling a policy can take time; do not ship sharing until
both are active. This PR does not deploy production infrastructure.

Shared manifests and each payload chunk expire 365 days after their last successful
load. Loading refreshes all of them atomically. Rules reject expired links immediately;
Firestore deletes expired documents asynchronously, typically within 24 hours. TTL
does not cascade into subcollections, so shared chunks are separate TTL-enabled
documents. Private backup chunks have a null expiry. Replacement and deletion commit
an atomic manifest with a cleanup queue, then remove obsolete chunks in batches.
Interrupted cleanup retries on the next sync. Rules allow five minutes of browser clock skew on expiry,
while the last-load timestamp always comes from the server.

See [Firebase TTL documentation](https://firebase.google.com/docs/firestore/ttl).
With Firebase CLI and Java available, validate the deployed rules locally with
`firebase emulators:exec --project demo-electrify-cloud-saves --only firestore "node scripts/cloud-save-rules-smoke.js"`.
This checks private ownership, frozen payloads, bounded retention and the maximum
60-chunk anonymous refresh against the actual rules engine. TTL deletion itself
requires a live TTL policy; the emulator does not run the TTL service.
Normal gameplay and cloud backup never change an already-created share link.
Recovery downloads remain available when browser storage is damaged or full; the
normal import/export controls are replaced by cloud backup and Share.
