const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { verifyBuild } = require("./desktop-verify");
const { verifyEditionBundle } = require("./verify-edition-bundle");
const { buildVersion, writeBuildVersion } = require("./build-version");

function desktopBuild() {
  const version = buildVersion();
  if (Number(process.versions.node.split(".")[0]) !== 24)
    throw new Error("Use Node 24 to build Electrify");
  for (const script of [
    "scripts/run-compatibility.js",
    "scripts/generate-icon-manifest.js",
    "scripts/generate-steam-localization.js",
    "scripts/generate-achievements.js",
    "node_modules/react-scripts/bin/react-scripts.js",
  ]) {
    const arguments_ = script.includes("react-scripts")
      ? [script, "build"]
      : [script];
    const result = spawnSync(process.execPath, arguments_, {
      stdio: "inherit",
      env: {
        ...process.env,
        PUBLIC_URL: "",
        GENERATE_SOURCEMAP: "false",
        REACT_APP_DESKTOP: "true",
        REACT_APP_VERSION: version,
      },
    });
    if (result.error || result.status !== 0)
      throw result.error || new Error(`Desktop build failed: ${script}`);
  }
  verifyEditionBundle("build", "desktop");
  writeBuildVersion(version);
  const assets = verifyBuild("build", "public");
  fs.writeFileSync(
    path.join("build", "desktop-assets.json"),
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
