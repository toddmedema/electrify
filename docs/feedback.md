# In-game feedback delivery

Electrify sends feedback to the inbox configured on the Firebase callable. The game includes
the feedback text, optional reply email, build version, menu or milestone source, and scenario
ID and outcome when available. The callable uses one Firestore document for a global delivery
budget. Feedback messages and contact details stay in Resend and the recipient's inbox.

## Production setup

1. In Resend, verify the sender domain and create a sending-only API key for that domain.
2. In Firebase project `electrify-game`, configure the JSON secret `GAME_FEEDBACK_EMAIL` with
   string properties `apiKey`, `from`, and `to`. Use a mailbox at the verified domain for
   `from` and the inbox that should receive player feedback for `to`. For example, after preparing
   the JSON in a secure location outside the repository, run
   `npx firebase-tools@15 functions:secrets:set GAME_FEEDBACK_EMAIL --project electrify-game --format=json --data-file /path/to/secret.json`.
3. From the release checkout, run `npm ci --prefix firebase/functions` and
   `npx firebase-tools@15 deploy --only functions:mailing-list:submitGameFeedback --project electrify-game`.
   Deploy the callable before releasing the client. The website deploy selects
   `subscribeMailingList` explicitly so its existing job does not need the feedback secret.
   Repeat the targeted deploy for backend changes or secret rotation.
4. In the website and Steam release, submit a test from the game menu and verify both the in-game
   confirmation and receipt in the inbox.

The callable accepts anonymous submissions and allows eight delivery attempts per minute and
80 per UTC day across all clients. A fixed subject and recipient keep player input in the
plain-text body or the optional reply address. The email API deduplicates identical retries
using a submission key. Browser test suites intercept submission requests, and the Steam
renderer uses a dedicated IPC operation with a fixed destination.
