const { deferStyles } = require("./site/defer-styles");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { buildVersion, writeBuildVersion } = require("./build-version");
const { verifyEditionBundle } = require("./verify-edition-bundle");
const { coopRelayUrl } = require("../electron/coop-relay-url.cjs");

const steamAppId = process.env.REACT_APP_STEAM_APP_ID;
if (
  steamAppId &&
  (!/^[1-9][0-9]{0,9}$/.test(steamAppId) || Number(steamAppId) > 2147483647)
)
  throw new Error("Invalid Steam App ID for multiplayer invitations");

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
writeBuildVersion(version, output);
verifyEditionBundle(output, "web");
