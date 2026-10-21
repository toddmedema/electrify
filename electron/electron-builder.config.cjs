module.exports = {
  extends: null,
  extraMetadata: { main: "electron/main.cjs" },
  appId: "com.electrifygame.desktop",
  productName: "Electrify",
  executableName: "Electrify",
  directories: { output: "dist/desktop" },
  asar: true,
  asarUnpack: [
    "node_modules/steamworks.js/**/*",
    "node_modules/koffi/**/*",
    "node_modules/@koromix/koffi-*/**/*",
  ],
  npmRebuild: false,
  extraResources: [{ from: "steamworks/input", to: "steam-input" }],
  files: [
    "build/**/*",
    "electron/**/*.cjs",
    "src/mods/ModSchema.js",
    "!electron/*.test.cjs",
    "!electron/electron-builder.config.cjs",
    "desktop-config.json",
    "package.json",
    "LICENSE.md",
    "!node_modules/**/*",
    "node_modules/steamworks.js/**/*",
    "node_modules/koffi/**/*",
    "node_modules/@koromix/koffi-*/**/*",
  ],
  win: {
    target: [{ target: "dir", arch: ["x64"] }],
    icon: "public/images/icon/512x512.png",
    signAndEditExecutable: false,
  },
  linux: {
    target: [{ target: "dir", arch: ["x64"] }],
    category: "Game",
    icon: "public/images/icon/512x512.png",
  },
  mac: {
    // One app for Intel and Apple Silicon: Steam has a single macOS platform and does not
    // choose depots by CPU architecture.
    target: [{ target: "dir", arch: ["universal"] }],
    // Both architecture passes bundle identical copies of every native module slice (the
    // universal Steam SDK, both steamworks.js bindings and both Koffi packages).
    x64ArchFiles:
      "Contents/Resources/app.asar.unpacked/node_modules/{steamworks.js/dist/osx/*,@koromix/koffi-darwin-*/**/*}",
    category: "public.app-category.simulation-games",
    icon: "public/images/icon/512x512.png",
    minimumSystemVersion: "13.0",
    hardenedRuntime: true,
    entitlements: "electron/entitlements.mac.plist",
    entitlementsInherit: "electron/entitlements.mac.plist",
  },
};
