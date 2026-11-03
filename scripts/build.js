const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { buildVersion, writeBuildVersion } = require("./build-version");
const { verifyEditionBundle } = require("./verify-edition-bundle");

const version = buildVersion();
const output = process.env.BUILD_PATH || "build";
const result = spawnSync(
  process.execPath,
  [path.join(__dirname, "production-build.js")],
  {
    stdio: "inherit",
    env: { ...process.env, REACT_APP_VERSION: version },
  },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
writeBuildVersion(version, output);
verifyEditionBundle(output, "web");
