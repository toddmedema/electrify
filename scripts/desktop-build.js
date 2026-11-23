const fs = require("node:fs");
const { coopRelayUrl } = require("../electron/coop-relay-url.cjs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { verifyBuild } = require("./desktop-verify");
const { verifyEditionBundle } = require("./verify-edition-bundle");
const { buildVersion, writeBuildVersion } = require("./build-version");

function desktopBuild() {
  const version = buildVersion();
  const output = process.env.BUILD_PATH || "build";
  const relay = coopRelayUrl(process.env.REACT_APP_COOP_RELAY_URL);
  if (Number(process.versions.node.split(".")[0]) !== 26)
    throw new Error("Use Node 26 to build Electrify");
  for (const script of [
    "scripts/run-compatibility.js",
    "scripts/generate-icon-manifest.js",
    "scripts/generate-steam-localization.js",
    "scripts/generate-achievements.js",
    "scripts/production-build.js",
  ]) {
    const result = spawnSync(process.execPath, [script], {
      stdio: "inherit",
      env: {
        ...process.env,
        PUBLIC_URL: "",
        GENERATE_SOURCEMAP: "false",
        REACT_APP_DESKTOP: "true",
        REACT_APP_COOP_RELAY_URL: relay?.href || "",
        REACT_APP_VERSION: version,
      },
    });
    if (result.error || result.status !== 0)
      throw result.error || new Error(`Desktop build failed: ${script}`);
  }
  verifyEditionBundle(output, "desktop");
  writeBuildVersion(version, output);
  fs.writeFileSync(
    path.join(output, "coop-relay.json"),
    JSON.stringify({ url: relay?.href }) + "\n",
  );
  const assets = verifyBuild(output, "public");
  fs.writeFileSync(
    path.join(output, "desktop-assets.json"),
    JSON.stringify(assets, null, 2) + "\n",
  );
  console.error(
    `Offline desktop build verified: ${assets.length} bundled assets.`,
  );
}
if (require.main === module) {
  try {
    desktopBuild();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { desktopBuild };
