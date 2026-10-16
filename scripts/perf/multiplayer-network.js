#!/usr/bin/env node
// Real room views through the shipping Steam codec; timings are reported, not gated.
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "electrify-network-"));
const resultFile = path.join(directory, "result.json");
try {
  const child = spawnSync(
    process.execPath,
    [
      require.resolve("./jest-baseline"),
      "--watchAll=false",
      "--runInBand",
      "--testMatch",
      "**/src/testing/MultiplayerNetworkBench.ts",
    ],
    {
      cwd: root,
      stdio: ["inherit", 2, "inherit"],
      env: { ...process.env, CI: "true", MP_NETWORK_RESULT: resultFile },
    },
  );
  if (child.status !== 0 || !fs.existsSync(resultFile))
    process.exitCode = child.status || 1;
  else process.stdout.write(fs.readFileSync(resultFile, "utf8") + "\n");
} finally {
  if (fs.existsSync(resultFile)) fs.unlinkSync(resultFile);
  fs.rmdirSync(directory);
}
