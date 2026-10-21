const { spawnSync } = require("node:child_process");
const { buildVersion, writeBuildVersion } = require("./build-version");
const { verifyEditionBundle } = require("./verify-edition-bundle");
require("./generate-notices").generateNotices();

const version = buildVersion();
const result = spawnSync(
  process.execPath,
  [require.resolve("react-scripts/bin/react-scripts"), "build"],
  {
    stdio: "inherit",
    env: { ...process.env, REACT_APP_VERSION: version },
  },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
writeBuildVersion(version);
verifyEditionBundle("build", "web");
