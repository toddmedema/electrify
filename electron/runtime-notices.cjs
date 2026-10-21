const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const RUNTIME_NOTICE_FILES = ["LICENSE", "LICENSES.chromium.html"];
const NOTICE_ALIASES = {
  "notices-chromium.html": "LICENSES.chromium.html",
};

function runtimeNoticeFilename(relative) {
  return Object.hasOwn(NOTICE_ALIASES, relative)
    ? NOTICE_ALIASES[relative]
    : undefined;
}

/** Read the expectations captured from the actual target runtime at extraction. */
function readRuntimeNoticeAssets(directory, electronVersion) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(directory, "manifest.json"), "utf8"),
  );
  if (
    typeof electronVersion !== "string" ||
    manifest.version !== electronVersion ||
    !Array.isArray(manifest.files) ||
    manifest.files.length !== RUNTIME_NOTICE_FILES.length ||
    RUNTIME_NOTICE_FILES.some(
      (name) =>
        manifest.files.filter(
          (file) =>
            file?.name === name &&
            Number.isSafeInteger(file.bytes) &&
            file.bytes > 0 &&
            typeof file.sha256 === "string" &&
            /^[a-f0-9]{64}$/.test(file.sha256),
        ).length !== 1,
    )
  )
    throw new Error(
      "Packaged Electron notice manifest differs from the runtime",
    );
  for (const expected of manifest.files) {
    const bytes = fs.readFileSync(path.join(directory, expected.name));
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    if (bytes.length !== expected.bytes || sha256 !== expected.sha256)
      throw new Error(`Packaged Electron notice mismatch: ${expected.name}`);
  }
  return Object.entries(NOTICE_ALIASES).map(([alias, name]) => {
    const { bytes, sha256 } = manifest.files.find((file) => file.name === name);
    return { path: alias, bytes, sha256 };
  });
}

/** Every served URL stays checked, including platform-specific native aliases. */
function effectiveAssetManifest(sharedAssets, runtimeNotices, electronVersion) {
  const nativeAssets = readRuntimeNoticeAssets(runtimeNotices, electronVersion);
  for (const asset of nativeAssets)
    if (
      sharedAssets.filter((shared) => shared.path === asset.path).length !== 1
    )
      throw new Error(
        `Shared renderer is missing native notice alias: ${asset.path}`,
      );
  return sharedAssets.map(
    (asset) =>
      nativeAssets.find((native) => native.path === asset.path) || asset,
  );
}

module.exports = {
  RUNTIME_NOTICE_FILES,
  runtimeNoticeFilename,
  readRuntimeNoticeAssets,
  effectiveAssetManifest,
};
