# Web sign-in

All web sign-in entry points offer Google and Apple through the shared
`SignInButtons` control. Its two equal columns keep both providers next to each
other, including on 360 px phones. Firebase handles the OAuth popup and session;
the existing auth-state listener starts profile, achievement and cloud-save sync
for either provider. The Steam desktop edition continues using Steam accounts.

## Enable Apple in production

Before deploying the client, configure Sign in with Apple in the Apple Developer
account and enable Apple under Firebase Authentication's sign-in providers:

1. Register a Services ID associated with an app enabled for Sign in with Apple.
2. Register `electrify-game.firebaseapp.com` as the web domain and
   `https://electrify-game.firebaseapp.com/__/auth/handler` as the return URL.
3. Create a Sign in with Apple key. In Firebase's Apple provider configuration,
   enter the Services ID, Apple Team ID, key ID and private key. Keep the private
   key in the provider configuration; it must never enter the web bundle.
4. Confirm the deployed site's domains are authorized in Firebase Authentication.
5. Test a real Apple sign-in on desktop and iOS Safari, including cancellation,
   returning sign-in and Hide My Email. Confirm cloud saves and achievements sync
   after signing out and back in with the same provider.

The app uses Firebase's `OAuthProvider("apple.com")` and the same popup flow as
Google. Firebase requests Apple's email and name scopes with its default
one-account-per-email setting. Apple may omit a name on later sign-ins and does
not provide an avatar; the player still chooses their own public leaderboard name.
Hide My Email relay addresses are accepted as Firebase identities. There is no
custom account-linking flow; players should use the same provider to return to
their existing saves. If Firebase sends account emails, configure Apple's private
email relay for the Firebase sender as well.

See [Firebase's Apple authentication setup](https://firebase.google.com/docs/auth/web/apple).
Local automated tests exercise provider selection, cancellation, retries, sharing,
and responsive controls without Apple credentials. A successful live Apple login
also requires the console configuration above and an eligible Apple account.
