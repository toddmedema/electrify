# Web sign-in and optional mailing-list signup

Web sign-in uses the existing Google Firebase OAuth popup. The auth-state
listener starts profile, achievement and cloud-save sync. The Steam desktop
edition continues using Steam accounts.

Each web sign-in entry point includes an unchecked “Join the Electrify
mailing list” checkbox. Choosing it subscribes the account email after a successful
Google login. Leaving it unchecked, cancelling OAuth, restoring an existing
session or playing through Steam never initiates a subscription. The choice is
local to the sign-in screen and is not saved to the account or device.

The client calls `subscribeMailingList` in `us-central1` without delaying login or
cloud sync. The callable validates Firebase authentication, a verified Google
email, the matching user ID and the consent version. It derives the email from the
verified token, never from a client-supplied address. The Mailchimp API key remains
in Firebase Secret Manager.

New contacts are created with `status: subscribed` (single opt-in, no confirmation
step), a signup timestamp and consent/source tags. Mailchimp's create endpoint
prevents duplicates, including concurrent requests. Existing subscribers are left
alone; pending, unsubscribed and cleaned contacts are not silently reactivated.
Those players can use the About page's Mailchimp form to manage rejoining. A toast
reports success or directs the player to About if signup fails, even after the
sign-in dialog closes. This checkbox is an invitation to join, not a subscription
management or unsubscribe control.

## Production setup before merging

1. Enable Firebase Functions billing (Blaze) and ensure the deployment service
   account can deploy second-generation functions and access Secret Manager.
2. Create a Mailchimp Marketing API key for the existing Electrify audience
   `8ccd05ccba`, then store it with
   `npx firebase-tools@15.32.1 functions:secrets:set MAILCHIMP_API_KEY --project electrify-game`.
   Enter the key at the prompt; never put it in a `REACT_APP_` variable or Git.
3. In Mailchimp, publish a welcome automation for contacts joining this audience.
   Include API-added subscribers, send immediately, and disable repeat entry.
   The email should say “You're subscribed to Electrify updates”, explain that
   updates are occasional, and include Mailchimp's unsubscribe link. There must
   be no confirmation action. Avoid a second welcome automation for the same
   subscribers. The signup API does **not** send a welcome email itself;
   [Mailchimp's final welcome email](https://mailchimp.com/help/enable-or-disable-final-welcome-email/)
   is a signup-form setting; use the welcome automation for these API signups.
4. Install the server lockfile with `npm ci --prefix firebase/functions`, then
   deploy with
   `npx firebase-tools@15.32.1 deploy --only functions:mailing-list --project electrify-game`.
   The production workflow also installs and deploys this function before the web
   bundle. Missing secrets or deployment permissions must be resolved first.
5. With a fresh Google test address, check the box and sign in. Verify exactly one
   subscribed contact in Mailchimp and one welcome notification, without any
   confirmation requirement. Test unchecked and cancelled sign-ins, repeat logins,
   an existing subscriber and a prior unsubscribe. Verify that a signup failure
   still permits cloud saves. Remove test contacts afterward.

Local tests mock Mailchimp and Firebase OAuth; they do not send emails. Live
subscription and welcome delivery require the configuration above and were not
exercised with production credentials.
