const { deferStyles } = require("./site/defer-styles");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const { buildVersion, writeBuildVersion } = require("./build-version");
const { verifyEditionBundle } = require("./verify-edition-bundle");
const { coopRelayUrl } = require("../electron/coop-relay-url.cjs");

const site = spawnSync(
  process.execPath,
  [path.join(__dirname, "site/generate.js"), "--check"],
  {
    stdio: "inherit",
  },
);
if (site.error) throw site.error;
if (site.status !== 0) process.exit(site.status || 1);

const version = buildVersion();
const output = process.env.BUILD_PATH || "build";
const relay = coopRelayUrl(process.env.REACT_APP_COOP_RELAY_URL);
const result = spawnSync(
  process.execPath,
  [path.join(__dirname, "production-build.js"), ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      REACT_APP_VERSION: version,
      REACT_APP_COOP_RELAY_URL: relay?.href || "",
    },
  },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
deferStyles(path.resolve(output, "index.html"));
const steamAppId = process.env.REACT_APP_STEAM_APP_ID;
if (steamAppId) {
  if (!/^[1-9][0-9]{0,9}$/.test(steamAppId) || Number(steamAppId) > 2147483647)
    throw new Error("Invalid Steam App ID for the invitation landing page");
  const invitePath = path.resolve(output, "invite/index.html");
  const invite = fs
    .readFileSync(invitePath, "utf8")
    .replace(
      'name="electrify-steam-app" content=""',
      `name="electrify-steam-app" content="${steamAppId}"`,
    );
  fs.writeFileSync(invitePath, invite);
}
writeBuildVersion(version, output);
verifyEditionBundle(output, "web");
