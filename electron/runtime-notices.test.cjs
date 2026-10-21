const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { preserveRuntimeNotices } = require("../scripts/runtime-notices.js");
const { effectiveAssetManifest } = require("./runtime-notices.cjs");
const { resolveAsset } = require("./runtime.cjs");

const version = require("../package-lock.json").packages[
  "node_modules/electron"
].version;

function integrity(name, bytes) {
  return {
    path: name,
    bytes: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}

function fixture(t) {
  const parent = path.resolve(".tmp", "native-tests");
  fs.mkdirSync(parent, { recursive: true });
  const directory = fs.mkdtempSync(path.join(parent, "notice-protocol-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const build = path.join(directory, "shared-linux-build");
  fs.mkdirSync(build);
  const sources = {
    "index.html": Buffer.from("<html>Electrify</html>"),
    "notices-chromium.html": Buffer.from("<html>Linux Chromium terms</html>"),
    "game.js": Buffer.from("game();"),
  };
  const sharedAssets = Object.entries(sources).map(([name, bytes]) => {
    fs.writeFileSync(path.join(build, name), bytes);
    return integrity(name, bytes);
  });
  const appOutDir = path.join(directory, "windows-runtime");
  fs.mkdirSync(appOutDir);
  const targetBytes = Buffer.from(
    "<html>Windows Chromium terms differ from the shared Linux build</html>\r\n",
  );
  fs.writeFileSync(
    path.join(appOutDir, "LICENSE.electron.txt"),
    "Electron MIT",
  );
  fs.writeFileSync(path.join(appOutDir, "LICENSES.chromium.html"), targetBytes);
  preserveRuntimeNotices({
    appOutDir,
    electronPlatformName: "win32",
    packager: { info: { framework: { version } } },
  });
  const target = path.join(appOutDir, "resources", "runtime-notices");
  return { build, target, targetBytes, sharedAssets };
}

test("the complete served-asset audit uses target runtime notices with a foreign build host", (t) => {
  const { build, target, targetBytes, sharedAssets } = fixture(t);
  const original = structuredClone(sharedAssets);
  const expected = effectiveAssetManifest(sharedAssets, target, version);
  assert.equal(expected.length, sharedAssets.length);
  assert.deepEqual(
    sharedAssets,
    original,
    "Keep the shared artifact immutable",
  );

  for (const asset of expected) {
    const url = `electrify://app/${asset.path}`;
    const served = fs.readFileSync(resolveAsset(build, url, target));
    assert.deepEqual(integrity(asset.path, served), asset);
    if (asset.path !== "notices-chromium.html")
      assert.deepEqual(
        asset,
        original.find((entry) => entry.path === asset.path),
      );
  }

  const actualTarget = fs.readFileSync(
    resolveAsset(build, "electrify://app/notices-chromium.html", target),
  );
  assert.deepEqual(actualTarget, targetBytes);
  const targetIntegrity = integrity("notices-chromium.html", actualTarget);
  const oldBuildExpectation = original.find(
    (asset) => asset.path === "notices-chromium.html",
  );
  assert.notEqual(targetIntegrity.bytes, oldBuildExpectation.bytes);
  assert.notEqual(targetIntegrity.sha256, oldBuildExpectation.sha256);
  assert.deepEqual(
    expected.find((asset) => asset.path === "notices-chromium.html"),
    targetIntegrity,
  );

  fs.appendFileSync(path.join(target, "LICENSES.chromium.html"), "modified");
  assert.throws(
    () => effectiveAssetManifest(sharedAssets, target, version),
    /Packaged Electron notice mismatch: LICENSES.chromium.html/,
  );
});

test("target notice expectations reject incomplete, altered or mismatched extraction metadata", (t) => {
  const cases = [
    [
      "version",
      (manifest) => {
        manifest.version = "0.0.0";
      },
    ],
    [
      "missing entry",
      (manifest) => {
        manifest.files.pop();
      },
    ],
    [
      "duplicate entry",
      (manifest) => {
        manifest.files[1] = manifest.files[0];
      },
    ],
    [
      "wrong size",
      (manifest) => {
        manifest.files[1].bytes++;
      },
    ],
    [
      "wrong hash",
      (manifest) => {
        manifest.files[1].sha256 = "0".repeat(64);
      },
    ],
    [
      "unsafe filename",
      (manifest) => {
        manifest.files[1].name = "../LICENSES.chromium.html";
      },
    ],
  ];
  for (const [label, mutate] of cases) {
    const { target, sharedAssets } = fixture(t);
    const filename = path.join(target, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(filename, "utf8"));
    mutate(manifest);
    fs.writeFileSync(filename, JSON.stringify(manifest));
    assert.throws(
      () => effectiveAssetManifest(sharedAssets, target, version),
      /Packaged Electron notice (?:manifest|mismatch)/,
      label,
    );
  }
  const { target, sharedAssets } = fixture(t);
  fs.rmSync(path.join(target, "LICENSE"));
  assert.throws(
    () => effectiveAssetManifest(sharedAssets, target, version),
    /ENOENT/,
  );
});

test("an effective audit retains exactly one expectation for every runtime notice URL", (t) => {
  const { target, sharedAssets } = fixture(t);
  const alias = sharedAssets.find(
    (asset) => asset.path === "notices-chromium.html",
  );
  for (const assets of [
    sharedAssets.filter((asset) => asset !== alias),
    [...sharedAssets, alias],
  ])
    assert.throws(
      () => effectiveAssetManifest(assets, target, version),
      /Shared renderer is missing native notice alias: notices-chromium.html/,
    );
});
