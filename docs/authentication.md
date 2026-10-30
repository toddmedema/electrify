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

1. Complete the [one-time Google Cloud setup](#one-time-google-cloud-setup) below.
   API enablement and IAM grants persist across releases; they do not need to be
   repeated on every deployment.
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

## One-time Google Cloud setup

The first mailing-list deployment in [run 41004209464](https://github.com/toddmedema/electrify/actions/runs/41004209464)
failed because `cloudbuild.googleapis.com` and `artifactregistry.googleapis.com`
were disabled in `electrify-game`, and the `FIREBASE_SERVICE_ACCOUNT` credentials
could not enable APIs. Firestore rules compiled successfully, but the combined
Firebase deploy exited before the web build or AWS deployment started. This is a
project provisioning failure; rebuilding the app or retrying unchanged cannot
resolve it.

A project owner should complete these steps before retrying:

1. Confirm that `electrify-game` is on the [Blaze billing plan](https://console.firebase.google.com/project/electrify-game/usage/details).
2. Enable [Cloud Build](https://console.cloud.google.com/apis/library/cloudbuild.googleapis.com?project=electrify-game)
   and [Artifact Registry](https://console.cloud.google.com/apis/library/artifactregistry.googleapis.com?project=electrify-game).
   Click **Enable** if offered; an already enabled API needs no change.
   To provision the other second-generation function dependencies at the same
   time, open [Google Cloud Shell](https://shell.cloud.google.com/?project=electrify-game)
   as the owner and run:

   ```sh
   gcloud services enable \
     cloudfunctions.googleapis.com \
     cloudbuild.googleapis.com \
     artifactregistry.googleapis.com \
     run.googleapis.com \
     eventarc.googleapis.com \
     pubsub.googleapis.com \
     storage.googleapis.com \
     secretmanager.googleapis.com \
     --project=electrify-game
   ```

   Enabling APIs requires `serviceusage.services.enable`, available through
   Service Usage Admin or Owner. Use an owner for this one-time setup; the failed
   run does not establish a need to grant API administration to the CI account.
   See [Google's API enablement guidance](https://docs.cloud.google.com/docs/buildpacks/build-function).

3. Confirm the Mailchimp secret and welcome automation in the production setup
   above. In [Secret Manager](https://console.cloud.google.com/security/secret-manager?project=electrify-game),
   `MAILCHIMP_API_KEY` must have an enabled version. Create it through the Firebase
   CLI's interactive prompt if absent; never paste the key into a GitHub issue,
   workflow log or client environment variable.
4. Check the deployment account's function permissions below. In particular,
   resolve the [Service Account User error](#service-account-user-error-on-retry)
   if the CLI reports missing `iam.serviceAccounts.actAs`.
5. Allow API enablement and IAM changes to propagate, then open the failed Actions run and choose
   **Re-run all jobs**. Keep the backend deploy required before publishing the
   client; skipping it would publish signup controls without their backend.

The failed run stopped before checking all function prerequisites. If the next
attempt reports a different permission error, inspect the principal represented
by `FIREBASE_SERVICE_ACCOUNT` in the project's [IAM page](https://console.cloud.google.com/iam-admin/iam?project=electrify-game).
Its existing Firestore permissions alone do not prove it can deploy functions.
[Firebase's function deployment guidance](https://firebase.google.com/docs/projects/iam/permissions#functions)
requires Cloud Functions Admin and Service Account User; the latter must cover
this function's runtime service account. Secret access and build-service-account
errors should be resolved for the principal and resource named in the error;
see [Google's function deployment troubleshooting](https://docs.cloud.google.com/functions/docs/troubleshooting).
Do not replace the CI credential with an owner key to bypass missing setup.

After deployment succeeds, perform the live subscription checks above. A green
infrastructure deploy does not verify Mailchimp welcome-email delivery.

### Service Account User error on retry

[Attempt 2](https://github.com/toddmedema/electrify/actions/runs/41004209464/attempts/2)
failed in Firebase's IAM preflight: the deployment principal lacked
`iam.serviceAccounts.actAs` on `electrify-game@appspot.gserviceaccount.com`.
This check runs before API provisioning, so this attempt does not confirm that
the earlier API setup is complete.

As a project owner:

1. Identify the deployment principal from `client_email` in the original JSON
   used for GitHub's `FIREBASE_SERVICE_ACCOUNT` secret. GitHub does not reveal a
   saved secret's value. The principal is the CI service account, not the human
   owner running these setup steps.
2. Open [Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts?project=electrify-game)
   and select `electrify-game@appspot.gserviceaccount.com`, the target named in
   the error.
3. Under **Permissions**, find **Principals with access to this service account**
   and choose **Grant access**. Enter the deployment principal's email and select
   **Service Account User** (`roles/iam.serviceAccountUser`), then save. If it
   already has another role on this account, edit its entry and add this role.
   This grants access on the named account rather than every account in the project;
   see [Google's service account access instructions](https://docs.cloud.google.com/iam/docs/manage-access-service-accounts).
4. Wait for IAM propagation, then rerun the failed deployment. If another
   `actAs` error names a different account, apply the grant to that named account
   as well; the App Engine account checked by the CLI is distinct from the
   default Compute Engine runtime account used by second-generation functions.
