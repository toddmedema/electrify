const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  RUNTIME_NOTICE_FILES,
  readRuntimeNoticeAssets,
} = require("../electron/runtime-notices.cjs");

const VERSION = require("../package-lock.json").packages[
  "node_modules/electron"
].version;
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
  const files = RUNTIME_NOTICE_FILES.map((name) => {
    // electron-builder renames the non-Mac runtime's MIT license at extraction.
    const source =
      name === "LICENSE" && electronPlatformName !== "darwin"
        ? "LICENSE.electron.txt"
        : name;
    const bytes = fs.readFileSync(path.join(appOutDir, source));
    if (!bytes.toString("utf8").trim())
      throw new Error(`Empty Electron runtime notice: ${name}`);
    fs.writeFileSync(path.join(target, name), bytes);
    return { name, bytes: bytes.length, sha256: digest(bytes) };
  });
  fs.writeFileSync(
    path.join(target, "manifest.json"),
    JSON.stringify({ version: VERSION, files }) + "\n",
  );
}

function verifyRuntimeNotices(resources) {
  readRuntimeNoticeAssets(path.join(resources, "runtime-notices"), VERSION);
}

module.exports = { preserveRuntimeNotices, verifyRuntimeNotices };
