const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { finished } = require("node:stream/promises");
const {
  packageConfiguration,
  withOfflineMacSigning,
  signMacAdHoc,
} = require("../scripts/desktop-package.js");
const {
  assertAsset,
  verifyBuild,
  verifyArchiveAssets,
  digest,
} = require("../scripts/desktop-verify.js");

test("packaging refuses Git LFS pointer text and empty assets", () => {
  assert.throws(
    () =>
      assertAsset(
        Buffer.from(
          "version https://git-lfs.github.com/spec/v1\noid sha256:abc\n",
        ),
        "audio/music.mp3",
      ),
    /Git LFS/,
  );
  assert.throws(
    () => assertAsset(Buffer.alloc(0), "data/weather/region.bin"),
    /Empty/,
  );
});

test("offline packaging checks every public file against its compiled bundle", (t) => {
  const temporaryRoot = path.resolve(".tmp", "native-tests");
  fs.mkdirSync(temporaryRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(temporaryRoot, "assets-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const publicRoot = path.join(directory, "public");
  const buildRoot = path.join(directory, "build");
  const write = (root, name, bytes) => {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), bytes);
  };
  for (const root of [publicRoot, buildRoot]) {
    write(
      root,
      "index.html",
      '<html><link rel="canonical" href="https://electrifygame.com/"></html>',
    );
    write(root, "fonts/inter.woff2", "bundled-font");
    write(root, "data/weather/index.json", '{"regions":["region"]}');
    write(root, "data/weather/region.bin", Buffer.from([1, 2, 3, 4]));
  }
  write(buildRoot, "static/js/main.js", "console.log('game')");
  const assets = verifyBuild(buildRoot, publicRoot);
  assert.equal(assets.length, 5);
  assert(
    assets.some(
      (asset) =>
        asset.path === "fonts/inter.woff2" && asset.sha256.length === 64,
    ),
  );
  write(buildRoot, "data/weather/region.bin", "altered-weather");
  assert.throws(
    () => verifyBuild(buildRoot, publicRoot),
    /differs from its source/,
  );
});

test("desktop entry rejects remote executable resources before shipping", (t) => {
  const temporaryRoot = path.resolve(".tmp", "native-tests");
  fs.mkdirSync(temporaryRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(temporaryRoot, "remote-assets-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, "static/js"), { recursive: true });
  fs.writeFileSync(path.join(directory, "static/js/main.js"), "game()");
  fs.writeFileSync(
    path.join(directory, "index.html"),
    '<script src="https://example.com/game.js"></script>',
  );
  assert.throws(
    () => verifyBuild(directory, directory),
    /remote script or stylesheet/,
  );
});

test("real ASAR verification reads nested audio on the host platform and detects corruption or missing assets", async (t) => {
  const asar = require("@electron/asar");
  const temporaryRoot = path.resolve(".tmp", "native-tests");
  fs.mkdirSync(temporaryRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(temporaryRoot, "asar-assets-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  // Delay the actual fixture disk writes so an early ASAR promise resolution cannot
  // accidentally pass merely because the filesystem flush won the race this time.
  const delayedWrites = { count: 0 };
  for (const method of ["_write", "_writev"]) {
    const originalWrite = fs.WriteStream.prototype[method];
    t.mock.method(fs.WriteStream.prototype, method, function (...arguments_) {
      if (
        typeof this.path === "string" &&
        this.path.startsWith(`${directory}${path.sep}`)
      ) {
        delayedWrites.count++;
        setTimeout(() => originalWrite.apply(this, arguments_), 10);
      } else originalWrite.apply(this, arguments_);
    });
  }
  const source = path.join(directory, "app");
  const createArchive = async (destination) => {
    // The installed ASAR writer returns out.end(), which is the WriteStream, before
    // its queued disk writes finish. Wait for close before reading or changing sources.
    const output = await asar.createPackage(source, destination);
    await finished(output, { cleanup: true });
    assert.equal(output.closed, true);
  };
  const assetPath = "audio/basic/high.mp3";
  const target = path.join(source, "build", assetPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const original = Buffer.from([0x49, 0x44, 0x33, 1, 2, 3, 4, 5]);
  fs.writeFileSync(target, original);
  fs.writeFileSync(
    path.join(source, "build", "desktop-assets.json"),
    JSON.stringify([
      { path: assetPath, bytes: original.length, sha256: digest(original) },
    ]),
  );
  const archive = path.join(directory, "complete.asar");
  await createArchive(archive);
  assert.equal(verifyArchiveAssets(archive), 1);
  fs.writeFileSync(target, Buffer.from([0x49, 0x44, 0x33, 5, 4, 3, 2, 1]));
  const corrupted = path.join(directory, "corrupted.asar");
  await createArchive(corrupted);
  assert.throws(() => verifyArchiveAssets(corrupted), /hash mismatch/);
  fs.unlinkSync(target);
  const missing = path.join(directory, "missing.asar");
  await createArchive(missing);
  assert.throws(() => verifyArchiveAssets(missing), /not found/);
  assert(
    delayedWrites.count > 0,
    "The slow filesystem fixture must exercise delayed disk writes",
  );
});

test("Mac QA explicitly signs ad hoc because the pinned packager reports afterSign even when signing returns false", async (t) => {
  const { MacPackager } = require("app-builder-lib/out/macPackager");
  const { Arch } = require("electron-builder");
  const temporaryRoot = path.resolve(".tmp", "native-tests");
  fs.mkdirSync(temporaryRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(temporaryRoot, "mac-signing-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, "Electrify.app"));
  let attempts = 0;
  const unsigned = {
    appInfo: { productFilename: "Electrify" },
    platformSpecificBuildOptions: { identity: null },
    sign: async () => {
      attempts++;
      return false;
    },
  };
  // Exercise the installed packager's hook result without invoking macOS commands or keys.
  const emitsAfterSign = await MacPackager.prototype.signApp.call(
    unsigned,
    {
      appOutDir: directory,
      electronPlatformName: "darwin",
      arch: Arch.arm64,
    },
    false,
  );
  assert.equal(attempts, 1);
  assert.equal(
    emitsAfterSign,
    true,
    "The hook alone cannot prove that a Mac app was signed",
  );
  const offline = packageConfiguration("offline");
  assert.equal(
    offline.mac.identity,
    "-",
    "QA must perform actual local signing before strict signature verification",
  );
  assert.equal(offline.win.signAndEditExecutable, false);
  assert.equal(offline.mac.notarize, false);
  assert.equal(
    packageConfiguration("steam").mac.identity,
    undefined,
    "Steam builds retain real Developer ID discovery",
  );
});

test("only offline Mac PR signing is enabled, with release credentials removed and restored on failure", async () => {
  const environment = {
    CSC_LINK: "test-certificate",
    CSC_KEY_PASSWORD: "test-password",
    CSC_NAME: "test-installed-identity",
    CSC_FOR_PULL_REQUEST: "false",
    APPLE_API_KEY: "test-notarization-key",
    APPLE_ID: "test-apple-account",
    UNRELATED: "preserved",
  };
  const original = { ...environment };
  for (const [mode, platform] of [
    ["steam", "darwin"],
    ["offline", "win32"],
    ["offline", "linux"],
  ]) {
    await withOfflineMacSigning(
      mode,
      platform,
      () => assert.deepEqual(environment, original),
      environment,
    );
  }
  await assert.rejects(
    withOfflineMacSigning(
      "offline",
      "darwin",
      async () => {
        assert.deepEqual(environment, {
          CSC_FOR_PULL_REQUEST: "true",
          CSC_IDENTITY_AUTO_DISCOVERY: "false",
          UNRELATED: "preserved",
        });
        throw new Error("Ad-hoc signing failed");
      },
      environment,
    ),
    /Ad-hoc signing failed/,
  );
  assert.deepEqual(environment, original);
  assert.equal(
    await withOfflineMacSigning(
      "offline",
      "darwin",
      async () => "signed",
      environment,
    ),
    "signed",
  );
  assert.deepEqual(environment, original);
});

test("the installed Mac custom-sign hook forces ad-hoc signing even if it discovered a certificate", async (t) => {
  const { MacPackager } = require("app-builder-lib/out/macPackager");
  const optionsForFile = () => ({
    entitlements: "electron/entitlements.mac.plist",
    hardenedRuntime: true,
  });
  let received;
  t.mock.method(require("@electron/osx-sign"), "signAsync", async (options) => {
    received = options;
  });
  const packager = {
    appInfo: { type: "commonjs" },
    info: { getWorkspaceRoot: async () => process.cwd() },
  };
  await MacPackager.prototype.doSign.call(
    packager,
    {
      app: "Electrify.app",
      identity: "discovered-developer-certificate",
      keychain: "private-keychain",
      provisioningProfile: "release-profile",
      optionsForFile,
    },
    packageConfiguration("offline").mac,
    { name: "discovered-developer-certificate" },
  );
  assert.equal(received.identity, "-");
  assert.equal(received.identityValidation, false);
  assert.equal(received.keychain, undefined);
  assert.equal(received.provisioningProfile, undefined);
  assert.equal(received.preEmbedProvisioningProfile, false);
  assert.equal(received.optionsForFile, optionsForFile);
  assert.equal(packageConfiguration("steam").mac.sign, undefined);
  assert.equal(signMacAdHoc, packageConfiguration("offline").mac.sign);
});
