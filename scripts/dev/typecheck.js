const { spawnSync } = require("node:child_process");
for (const args of [["--noEmit"], ["-p", "e2e"]]) {
  const result = spawnSync(
    process.execPath,
    [require.resolve("typescript/bin/tsc"), ...args],
    { stdio: "inherit", windowsHide: true },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
