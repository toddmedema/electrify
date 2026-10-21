const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

/** The npm package pins Electron, but no longer downloads its runtime at install. */
function prepareElectronRuntime(
  root = path.resolve(__dirname, ".."),
  { run = spawnSync } = {},
) {
  const read = (name) =>
    JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
  const locked = read("package-lock.json").packages["node_modules/electron"];
  const installed = read("node_modules/electron/package.json");
  if (!locked?.version || installed.version !== locked.version)
    throw new Error(
      "Install the lockfile before preparing the Electron runtime: installed version differs from lockfile",
    );
  const directory = path.join(root, "node_modules/electron/dist");
  const complete = () => {
    try {
      return (
        fs
          .readFileSync(path.join(directory, "version"), "utf8")
          .trim()
          .replace(/^v/, "") === locked.version &&
        ["LICENSE", "LICENSES.chromium.html"].every((name) =>
          fs.readFileSync(path.join(directory, name), "utf8").trim(),
        )
      );
    } catch {
      return false;
    }
  };
  if (!complete()) {
    // The installer accepts version/path/executable as a complete cache, even
    // when legal files are missing. Remove only its marker to force extraction.
    fs.rmSync(path.join(root, "node_modules/electron/path.txt"), {
      force: true,
    });
    // Use this exact locked package's installer and checksum list. This also
    // works after a clean npm ci, without a manual local setup step or Electron UI.
    const result = run(
      process.execPath,
      [path.join(root, "node_modules/electron/install.js")],
      { cwd: root, stdio: "inherit", env: process.env },
    );
    if (result.error || result.status !== 0)
      throw (
        result.error ||
        new Error("Preparing the pinned Electron runtime failed")
      );
    if (!complete())
      throw new Error(
        `Electron ${locked.version} runtime is incomplete: exact version, LICENSE and LICENSES.chromium.html are required`,
      );
  }
  return { directory, version: locked.version };
}

module.exports = { prepareElectronRuntime };
