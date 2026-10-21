const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const VERSION = require("../package-lock.json").packages[
  "node_modules/electron"
].version;
const NAMES = ["LICENSE", "LICENSES.chromium.html"];
const digest = (bytes) =>
  crypto.createHash("sha256").update(bytes).digest("hex");

/** Preserve the target archive's terms before macOS branding removes them. */
function preserveRuntimeNotices({ appOutDir, electronPlatformName, packager }) {
  if (packager.info.framework.version !== VERSION)
    throw new Error("Packaged Electron runtime differs from the lockfile");
  const resources =
    electronPlatformName === "darwin"
      ? path.join(appOutDir, "Electron.app", "Contents", "Resources")
      : path.join(appOutDir, "resources");
  const target = path.join(resources, "runtime-notices");
  fs.mkdirSync(target, { recursive: true });
  const files = NAMES.map((name) => {
    // electron-builder renames the non-Mac runtime's MIT license at extraction.
    const source =
      name === "LICENSE" && electronPlatformName !== "darwin"
        ? "LICENSE.electron.txt"
        : name;
    const bytes = fs.readFileSync(path.join(appOutDir, source));
    if (!bytes.toString("utf8").trim())
      throw new Error(`Empty Electron runtime notice: ${name}`);
    fs.writeFileSync(path.join(target, name), bytes);
    return { name, sha256: digest(bytes) };
  });
  fs.writeFileSync(
    path.join(target, "manifest.json"),
    JSON.stringify({ version: VERSION, files }) + "\n",
  );
}

function verifyRuntimeNotices(resources) {
  const directory = path.join(resources, "runtime-notices");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(directory, "manifest.json"), "utf8"),
  );
  if (
    manifest.version !== VERSION ||
    !Array.isArray(manifest.files) ||
    manifest.files.length !== NAMES.length
  )
    throw new Error(
      "Packaged Electron notice manifest differs from the lockfile",
    );
  for (const name of NAMES) {
    const expected = manifest.files.find((file) => file.name === name);
    const bytes = fs.readFileSync(path.join(directory, name));
    if (!bytes.length || digest(bytes) !== expected?.sha256)
      throw new Error(`Packaged Electron notice mismatch: ${name}`);
  }
}

module.exports = { preserveRuntimeNotices, verifyRuntimeNotices };
