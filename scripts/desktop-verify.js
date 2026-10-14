/** Verify that the downloadable build contains every authored offline asset, with real LFS bytes. */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

function files(root, prefix = "") {
  return fs
    .readdirSync(path.join(root, prefix), { withFileTypes: true })
    .flatMap((entry) => {
      const name = path.posix.join(prefix, entry.name);
      if (entry.isSymbolicLink())
        throw new Error(`Unexpected asset symlink: ${name}`);
      return entry.isDirectory() ? files(root, name) : [name];
    });
}

function digest(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function assertAsset(data, name) {
  if (data.length === 0) throw new Error(`Empty bundled asset: ${name}`);
  if (
    data
      .subarray(0, 128)
      .toString("utf8")
      .startsWith("version https://git-lfs.github.com/spec/v1")
  )
    throw new Error(`Fetch Git LFS content before packaging: ${name}`);
}

function verifyBuild(root = "build", publicRoot = "public") {
  const manifest = [];
  for (const name of files(root)) {
    if (name === "desktop-assets.json") continue;
    const data = fs.readFileSync(path.join(root, name));
    assertAsset(data, name);
    manifest.push({ path: name, bytes: data.length, sha256: digest(data) });
  }
  for (const name of files(publicRoot)) {
    const source = fs.readFileSync(path.join(publicRoot, name));
    assertAsset(source, name);
    if (name === "index.html") continue; // CRA injects the compiled script and PUBLIC_URL.
    const target = fs.readFileSync(path.join(root, name));
    if (digest(source) !== digest(target))
      throw new Error(`Offline asset differs from its source: ${name}`);
  }
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  if (
    [...html.matchAll(/<(?:script|link)\b[^>]*>/gi)].some(
      ([tag]) =>
        !/rel=["']canonical["']/i.test(tag) &&
        /(?:src|href)=["']https?:\/\//i.test(tag),
    )
  )
    throw new Error(
      "Desktop index.html contains a remote script or stylesheet",
    );
  const workers = manifest.filter((asset) => /\.js$/.test(asset.path));
  if (!workers.some((asset) => asset.path.startsWith("static/js/")))
    throw new Error("Compiled game scripts are missing");
  const weather = JSON.parse(
    fs.readFileSync(path.join(root, "data/weather/index.json"), "utf8"),
  );
  if (
    !weather ||
    !manifest.some(
      (asset) =>
        asset.path.startsWith("data/weather/") && asset.path.endsWith(".bin"),
    )
  )
    throw new Error("Bundled weather data is missing");
  return manifest.sort((left, right) => left.path.localeCompare(right.path));
}

function verifyArchiveAssets(archive) {
  const asar = require("@electron/asar");
  const manifest = JSON.parse(
    asar
      .extractFile(archive, path.join("build", "desktop-assets.json"))
      .toString(),
  );
  for (const asset of manifest) {
    // ASAR's directory traversal splits on the host path separator, even though our
    // portable manifest records URL-style paths. Normalize every nested archive lookup.
    const data = asar.extractFile(archive, path.join("build", asset.path));
    assertAsset(data, asset.path);
    if (data.length !== asset.bytes || digest(data) !== asset.sha256)
      throw new Error(`Packaged asset hash mismatch: ${asset.path}`);
  }
  return manifest.length;
}

function verifyPackaged(directory) {
  const resources =
    process.platform === "darwin"
      ? path.join(directory, "Electrify.app", "Contents", "Resources")
      : path.join(directory, "resources");
  const archive = path.join(resources, "app.asar");
  const count = verifyArchiveAssets(archive);
  const platform = process.platform;
  const native =
    platform === "win32"
      ? [
          "steamworks.js/dist/win64/steam_api64.dll",
          "steamworks.js/dist/win64/steamworksjs.win32-x64-msvc.node",
        ]
      : platform === "linux"
        ? [
            "steamworks.js/dist/linux64/libsteam_api.so",
            "steamworks.js/dist/linux64/steamworksjs.linux-x64-gnu.node",
          ]
        : [
            "steamworks.js/dist/osx/libsteam_api.dylib",
            `steamworks.js/dist/osx/steamworksjs.darwin-${process.arch}.node`,
          ];
  for (const name of native) {
    const unpacked = path.join(
      resources,
      "app.asar.unpacked",
      "node_modules",
      name,
    );
    const actual = fs.readFileSync(unpacked);
    assertAsset(actual, name);
    if (
      digest(actual) !==
      digest(fs.readFileSync(path.join("node_modules", name)))
    )
      throw new Error(`Packaged native runtime mismatch: ${name}`);
  }
  const koffiRoot = path.join(
    "@koromix",
    `koffi-${process.platform}-${process.arch}`,
  );
  const koffiFiles = files(
    path.join(resources, "app.asar.unpacked", "node_modules", koffiRoot),
  );
  if (!koffiFiles.some((name) => name.endsWith(".node")))
    throw new Error("The packaged native Steam bridge is missing");
  for (const name of koffiFiles) {
    const source = fs.readFileSync(path.join("node_modules", koffiRoot, name));
    const packed = fs.readFileSync(
      path.join(
        resources,
        "app.asar.unpacked",
        "node_modules",
        koffiRoot,
        name,
      ),
    );
    if (digest(source) !== digest(packed))
      throw new Error(`Packaged native Steam bridge mismatch: ${name}`);
  }
  return count;
}

/** Signing changes native Mach-O signature bytes; raw native hashes were checked in afterPack. */
function verifySignedMacPackage(directory) {
  if (process.platform !== "darwin")
    throw new Error("Signed macOS packages must be verified on macOS");
  const application = path.join(directory, "Electrify.app");
  const result = spawnSync(
    "/usr/bin/codesign",
    ["--verify", "--deep", "--strict", application],
    { encoding: "utf8" },
  );
  if (result.error || result.status !== 0)
    throw (
      result.error ||
      new Error(`The signed macOS app failed verification: ${result.stderr}`)
    );
  return verifyArchiveAssets(
    path.join(application, "Contents", "Resources", "app.asar"),
  );
}

if (require.main === module) {
  try {
    const packaged = process.argv.includes("--packaged");
    const target =
      process.argv.find(
        (argument, index) => index > 1 && !argument.startsWith("--"),
      ) || "build";
    const result = packaged ? verifyPackaged(target) : verifyBuild(target);
    console.error(
      `Desktop asset verification passed (${Array.isArray(result) ? result.length : result} files).`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = {
  files,
  digest,
  assertAsset,
  verifyBuild,
  verifyArchiveAssets,
  verifyPackaged,
  verifySignedMacPackage,
};
