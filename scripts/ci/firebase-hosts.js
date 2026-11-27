// Match the Firebase SDK's shared endpoints and Firebase product domains used by the app.
// Keep both the Playwright route guard and the Chromium network backstop on this list.
const firebaseHosts = [
  "firestore.googleapis.com",
  "identitytoolkit.googleapis.com",
  "securetoken.googleapis.com",
  "firebase.googleapis.com",
  "firebaseinstallations.googleapis.com",
  "firebaseremoteconfig.googleapis.com",
  "firebasestorage.googleapis.com",
  "electrify-game.firebaseapp.com",
  "electrify-game.web.app",
  "*.cloudfunctions.net",
  "*.firebaseio.com",
  "*.firebasedatabase.app",
];

function isFirebaseHost(host) {
  const hostname = host.replace(/\.$/, "");
  return firebaseHosts.some((pattern) =>
    pattern.startsWith("*.")
      ? hostname.endsWith(pattern.slice(1))
      : hostname === pattern,
  );
}

const firebaseResolverRules = firebaseHosts
  .flatMap((host) => [host, `${host}.`])
  .map((host) => `MAP ${host} ~NOTFOUND`)
  .join(",");

module.exports = { isFirebaseHost, firebaseResolverRules };
