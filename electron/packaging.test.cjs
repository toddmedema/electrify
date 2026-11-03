const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { finished } = require("node:stream/promises");
const { FileMatcher } = require("app-builder-lib/out/fileMatcher");
const {
  packageConfiguration,
  withOfflineMacSigning,
  signMacAdHoc,
} = require("../scripts/desktop-package.js");
const {
  assertAsset,
  verifyBuild,
  verifyArchiveAssets,
  verifyInputResources,
  digest,
} = require("../scripts/desktop-verify.js");
const {
  preserveRuntimeNotices,
  verifyRuntimeNotices,
} = require("../scripts/runtime-notices.js");
const {
  arm64Slice,
  prepareMacArm64Package,
  verifyMacArm64Package,
} = require("../scripts/mac-arm64.js");

test("packaging accepts only the supported Mac architecture", () => {
  for (const arch of ["x64", "universal"]) {
    const result = spawnSync(
      process.execPath,
      [
        "scripts/desktop-package.js",
        "--mode",
        "offline",
        "--platform",
        "darwin",
        "--arch",
        arch,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /macOS ARM64/);
  }
});

test("package filters exclude Intel Mac native dependencies on every target", () => {
  const root = path.resolve(__dirname, "..");
  const nativeStat = fs.statSync(
    path.join(
      root,
      "node_modules/steamworks.js/dist/osx/steamworksjs.darwin-arm64.node",
    ),
  );
  for (const platform of ["darwin", "linux", "win32"]) {
    const config = packageConfiguration("offline", "dev", platform);
    assert.deepEqual(config.mac.target, [{ target: "dir", arch: ["arm64"] }]);
    const filter = new FileMatcher(
      root,
      path.join(root, ".tmp", "package-filter"),
      (value) => value,
      config.files,
    ).createFilter();
    for (const name of [
      "node_modules/steamworks.js/dist/osx/steamworksjs.darwin-x64.node",
      "node_modules/@koromix/koffi-darwin-x64/darwin_x64/koffi.node",
    ])
      assert.equal(filter(path.join(root, name), nativeStat), false, name);
    assert.equal(
      filter(
        path.join(
          root,
          "node_modules/steamworks.js/dist/osx/steamworksjs.darwin-arm64.node",
        ),
        nativeStat,
      ),
      platform === "darwin",
    );
  }
});

test("Mac packages extract the pinned SDK's ARM64 payload and reject other native architectures", (t) => {
  const temporaryRoot = path.resolve(".tmp", "native-tests");
  fs.mkdirSync(temporaryRoot, { recursive: true });
  const root = fs.mkdtempSync(path.join(temporaryRoot, "mac-arm64-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const application = path.join(root, "Electrify.app");
  const executable = path.join(application, "Contents", "MacOS", "Electrify");
  const library = path.join(
    application,
    "Contents",
    "Resources",
    "app.asar.unpacked",
    "node_modules",
    "steamworks.js",
    "dist",
    "osx",
    "libsteam_api.dylib",
  );
  const sdk = fs.readFileSync(
    "node_modules/steamworks.js/dist/osx/libsteam_api.dylib",
  );
  const arm = fs.readFileSync(
    "node_modules/steamworks.js/dist/osx/steamworksjs.darwin-arm64.node",
  );
  const intel = fs.readFileSync(
    "node_modules/steamworks.js/dist/osx/steamworksjs.darwin-x64.node",
  );
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.mkdirSync(path.dirname(library), { recursive: true });
  fs.writeFileSync(executable, arm);
  fs.writeFileSync(library, sdk);
  assert.throws(() => verifyMacArm64Package(root), /must be ARM64-only/);
  prepareMacArm64Package({ electronPlatformName: "darwin", appOutDir: root });
  verifyMacArm64Package(root);
  const alias = path.join(application, "Contents", "RuntimeAlias");
  fs.symlinkSync(
    path.dirname(library),
    alias,
    process.platform === "win32" ? "junction" : "dir",
  );
  verifyMacArm64Package(root);
  const outside = path.join(root, "outside");
  fs.mkdirSync(outside);
  const external = path.join(application, "Contents", "External");
  fs.symlinkSync(
    outside,
    external,
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(() => verifyMacArm64Package(root), /symlink leaves the app/);
  fs.unlinkSync(external);
  const thinned = fs.readFileSync(library);
  assert(thinned.length < sdk.length);
  assert.deepEqual(thinned, arm64Slice(sdk));
  assert.deepEqual(
    fs.readFileSync("node_modules/steamworks.js/dist/osx/libsteam_api.dylib"),
    sdk,
  );
  if (process.platform === "darwin") {
    const result = spawnSync("/usr/bin/lipo", ["-archs", library], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "arm64");
  }
  fs.writeFileSync(library, intel);
  assert.throws(() => verifyMacArm64Package(root), /must be ARM64-only/);
  fs.writeFileSync(library, thinned);
  fs.writeFileSync(executable, intel);
  assert.throws(() => verifyMacArm64Package(root), /must be ARM64-only/);
  assert.throws(() => arm64Slice(intel), /Missing ARM64/);
  assert.throws(
    () => arm64Slice(sdk.subarray(0, 8)),
    /Invalid Mach-O architecture table/,
  );
});

test("ARM64 slice extraction validates both byte orders and wide architecture bounds", () => {
  const arm = fs.readFileSync(
    "node_modules/steamworks.js/dist/osx/steamworksjs.darwin-arm64.node",
  );
  for (const wide of [false, true])
    for (const little of [false, true]) {
      const offset = wide ? 40 : 28;
      const fat = Buffer.alloc(offset + arm.length);
      const write32 = (value, position) =>
        little
          ? fat.writeUInt32LE(value, position)
          : fat.writeUInt32BE(value, position);
      write32(wide ? 0xcafebabf : 0xcafebabe, 0);
      write32(1, 4);
      write32(0x0100000c, 8);
      if (wide) {
        const write64 = (value, position) =>
          little
            ? fat.writeBigUInt64LE(value, position)
            : fat.writeBigUInt64BE(value, position);
        write64(BigInt(offset), 16);
        write64(BigInt(arm.length), 24);
      } else {
        write32(offset, 16);
        write32(arm.length, 20);
      }
      arm.copy(fat, offset);
      assert.deepEqual(arm64Slice(fat), arm);
      assert.throws(
        () => arm64Slice(fat.subarray(0, fat.length - 1)),
        /slice bounds/,
      );
    }
});

test("packaged app metadata uses the renderer artifact's build version", () => {
  const version = "26sept26-1507";
  for (const mode of ["steam", "offline"]) {
    const config = packageConfiguration(mode, version);
    assert.equal(config.extraMetadata.appVersion, version);
    assert.equal(config.extraMetadata.version, undefined);
    assert.equal(config.extraMetadata.main, "electron/main.cjs");
  }
  assert.equal(
    require("./electron-builder.config.cjs").extraMetadata.version,
    undefined,
  );
});

test("the packaged mod parser loads, validates and digests without checkout dependencies", (t) => {
  const source = path.resolve(__dirname, "..");
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "electrify-packaged-mods-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const probe = `
    const assert = require("node:assert/strict");
    const { ModStore } = require("./electron/mods.cjs");
    const codec = require("./electron/coop-codec.cjs");
    assert.deepEqual(codec.parse(codec.stringify({ value: Infinity })), { value: Infinity });
    const { parseMod, packageDigest } = require("./src/mods/ModSchema.js");
    assert.equal(typeof ModStore, "function");
    const pack = {
      schemaVersion: 1, gameApi: 1, id: "packaged-grid", title: "Packaged Grid",
      creator: "Creator", version: "1", description: "A grid planning challenge.",
      seed: 42,
      events: [{
        id: "dry-year", title: "A dry year", message: "Water inflow has fallen.",
        startMonth: 1, durationMonths: 12, preview: "Water inflow will fall.",
        effects: { hydroInflowMultiplier: { byDifficulty: {
          Intern: 0.9, Employee: 0.8, Manager: 0.7, VP: 0.6, CEO: 0.5
        } } }
      }]
    };
    const parsed = parseMod(JSON.stringify(pack));
    assert.deepEqual(parsed, pack);
    const digest = packageDigest(parsed);
    assert.match(digest, /^sha256-[a-f0-9]{64}$/);
    assert.equal(packageDigest({ ...parsed, $schema: "./scenario.schema.json" }), digest);
    assert.notEqual(packageDigest({ ...parsed, seed: 43 }), digest);
    assert.throws(() => parseMod(JSON.stringify({ ...pack, gameApi: 2 })), /gameApi/);
    process.stdout.write(JSON.stringify({ id: parsed.id, digest }));
  `;
  for (const mode of ["steam", "offline"]) {
    const directory = path.join(root, mode);
    const configured = new FileMatcher(
      source,
      directory,
      (value) => value,
      packageConfiguration(mode).files,
    ).createFilter();
    const stagedSources = [];
    const stage = (relative) => {
      const filename = path.join(source, relative);
      const stat = fs.statSync(filename);
      if (!configured(filename, stat)) return;
      if (stat.isDirectory()) {
        for (const name of fs.readdirSync(filename))
          stage(path.join(relative, name));
      } else {
        const target = path.join(directory, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(filename, target);
        if (relative.startsWith(`src${path.sep}`)) stagedSources.push(relative);
      }
    };
    for (const relative of ["src", "electron", "package.json"]) stage(relative);
    assert(stagedSources.every((file) => file.endsWith(".js")));
    const run = () =>
      spawnSync(process.execPath, ["-e", probe], {
        cwd: directory,
        encoding: "utf8",
        env: { ...process.env, NODE_PATH: "", NODE_OPTIONS: "" },
      });
    const result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).id, "packaged-grid");
    for (const dependency of [
      "ScenarioRulesSchema.js",
      "RuleIdentity.js",
      "ScenarioText.js",
    ]) {
      const filename = path.join(directory, "src", "helpers", dependency);
      const original = fs.readFileSync(filename);
      fs.unlinkSync(filename);
      const missing = run();
      assert.notEqual(missing.status, 0);
      assert.match(missing.stderr, /MODULE_NOT_FOUND/);
      assert(missing.stderr.includes(path.basename(dependency, ".js")));
      fs.writeFileSync(filename, original);
    }
    assert.equal(
      run().status,
      0,
      "Restoring the dependency must restore parser loading",
    );
  }
});

test("packaging preserves and verifies each target runtime's original notices before branding", (t) => {
  const temporaryRoot = path.resolve(".tmp", "native-tests");
  fs.mkdirSync(temporaryRoot, { recursive: true });
  const root = fs.mkdtempSync(path.join(temporaryRoot, "runtime-notices-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const version = require("../package-lock.json").packages[
    "node_modules/electron"
  ].version;
  for (const platform of ["win32", "linux", "darwin"]) {
    const appOutDir = path.join(root, platform);
    fs.mkdirSync(appOutDir);
    const licenseName =
      platform === "darwin" ? "LICENSE" : "LICENSE.electron.txt";
    const originals = {
      LICENSE: Buffer.from(`Electron ${platform} MIT notice\r\nCopyright\r\n`),
      "LICENSES.chromium.html": Buffer.from(
        `\ufeff<html>Chromium ${platform} original terms</html>\r\n`,
      ),
    };
    fs.writeFileSync(path.join(appOutDir, licenseName), originals.LICENSE);
    fs.writeFileSync(
      path.join(appOutDir, "LICENSES.chromium.html"),
      originals["LICENSES.chromium.html"],
    );
    const context = {
      appOutDir,
      electronPlatformName: platform,
      packager: { info: { framework: { version } } },
    };
    for (const mode of ["steam", "offline"])
      assert.equal(
        packageConfiguration(mode).afterExtract,
        preserveRuntimeNotices,
      );
    packageConfiguration("offline").afterExtract(context);
    const resources =
      platform === "darwin"
        ? path.join(appOutDir, "Electron.app", "Contents", "Resources")
        : path.join(appOutDir, "resources");
    const target = path.join(resources, "runtime-notices");
    for (const [name, original] of Object.entries(originals))
      assert.deepEqual(fs.readFileSync(path.join(target, name)), original);
    // Mac branding removes the archive-root notices. Verification must use the
    // copies that remain inside the final application's resources directory.
    fs.rmSync(path.join(appOutDir, licenseName));
    fs.rmSync(path.join(appOutDir, "LICENSES.chromium.html"));
    assert.doesNotThrow(() => verifyRuntimeNotices(resources));

    fs.appendFileSync(path.join(target, "LICENSES.chromium.html"), "modified");
    assert.throws(() => verifyRuntimeNotices(resources), /notice mismatch/);
    fs.writeFileSync(
      path.join(target, "LICENSES.chromium.html"),
      originals["LICENSES.chromium.html"],
    );
    fs.rmSync(path.join(target, "LICENSE"));
    assert.throws(() => verifyRuntimeNotices(resources), /ENOENT/);
    fs.writeFileSync(path.join(target, "LICENSE"), originals.LICENSE);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(target, "manifest.json"), "utf8"),
    );
    manifest.version = "0.0.0";
    fs.writeFileSync(
      path.join(target, "manifest.json"),
      JSON.stringify(manifest),
    );
    assert.throws(
      () => verifyRuntimeNotices(resources),
      /Packaged Electron notice manifest differs from the runtime/,
    );
    assert.throws(
      () =>
        preserveRuntimeNotices({
          ...context,
          packager: { info: { framework: { version: "0.0.0" } } },
        }),
      /lockfile/,
    );
    fs.writeFileSync(path.join(appOutDir, licenseName), " \n");
    assert.throws(
      () => preserveRuntimeNotices(context),
      /Empty Electron runtime notice/,
    );
  }
});

test("packaged Steam Input actions and defaults remain external to ASAR and match authored bytes", (t) => {
  const temporaryRoot = path.resolve(".tmp", "native-tests");
  fs.mkdirSync(temporaryRoot, { recursive: true });
  const resources = fs.mkdtempSync(path.join(temporaryRoot, "steam-input-"));
  t.after(() => fs.rmSync(resources, { recursive: true, force: true }));
  const source = path.join(__dirname, "../steamworks/input");
  const config = packageConfiguration("steam");
  const mapping = config.extraResources.find(
    (entry) => entry.from === "steamworks/input",
  );
  assert.equal(mapping.to, "steam-input");
  const target = path.join(resources, mapping.to);
  fs.cpSync(source, target, { recursive: true });
  assert.doesNotThrow(() => verifyInputResources(resources, source));
  const file = path.join(target, "controller_neptune.vdf");
  fs.appendFileSync(file, "\nchanged during packaging\n");
  assert.throws(
    () => verifyInputResources(resources, source),
    /Steam Input configuration mismatch/,
  );
  fs.copyFileSync(path.join(source, "controller_neptune.vdf"), file);
  fs.unlinkSync(path.join(target, "actions.vdf"));
  assert.throws(() => verifyInputResources(resources, source), /ENOENT/);
});

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
