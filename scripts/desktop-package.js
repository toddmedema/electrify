const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const builder = require("electron-builder");
const { desktopBuild } = require("./desktop-build");
const {
  verifyBuild,
  verifyPackaged,
  verifySignedMacPackage,
} = require("./desktop-verify");
const { verifyEditionBundle } = require("./verify-edition-bundle");

const MAC_ARCHITECTURES = ["arm64", "x64"];

function runNpm(args) {
  const [command, prefix] = process.env.npm_execpath
    ? [process.execPath, [process.env.npm_execpath]]
    : ["npm", []];
  const result = spawnSync(command, [...prefix, ...args], { stdio: "inherit" });
  if (result.error || result.status !== 0)
    throw result.error || new Error(`npm ${args.join(" ")} failed`);
}

function installedVersion(directory) {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(directory, "package.json"), "utf8"),
    ).version;
  } catch {
    return undefined;
  }
}

/** npm ci installs only the host's Koffi slice; the universal Mac app needs both. */
function installMacNativeSlices(root = process.cwd(), run = runNpm) {
  const lock = JSON.parse(
    fs.readFileSync(path.join(root, "package-lock.json"), "utf8"),
  );
  for (const arch of MAC_ARCHITECTURES) {
    const name = `@koromix/koffi-darwin-${arch}`;
    const key = `node_modules/${name}`;
    const entry = lock.packages[key];
    if (!entry) throw new Error(`package-lock.json does not pin ${name}`);
    const target = path.join(root, key);
    if (installedVersion(target) === entry.version) continue;
    const directory = path.join(root, ".tmp", `koffi-darwin-${arch}`);
    fs.rmSync(directory, { recursive: true, force: true });
    fs.mkdirSync(directory, { recursive: true });
    const manifest = {
      name: `electrify-koffi-darwin-${arch}`,
      private: true,
      optionalDependencies: { [name]: entry.version },
    };
    fs.writeFileSync(
      path.join(directory, "package.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    // Reuse the locked resolution and integrity verbatim; nothing is re-resolved.
    fs.writeFileSync(
      path.join(directory, "package-lock.json"),
      JSON.stringify(
        {
          name: manifest.name,
          lockfileVersion: 3,
          requires: true,
          packages: { "": manifest, [key]: entry },
        },
        null,
        2,
      ) + "\n",
    );
    // npm honours --os/--cpu only for optional dependencies, and skips a mismatch silently.
    run([
      "ci",
      "--prefix",
      directory,
      "--os=darwin",
      `--cpu=${arch}`,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ]);
    const installed = path.join(directory, key);
    if (installedVersion(installed) !== entry.version)
      throw new Error(`npm did not install the locked ${name}`);
    fs.rmSync(target, { recursive: true, force: true });
    fs.cpSync(installed, target, { recursive: true });
  }
}

async function signMacAdHoc(options) {
  return require("@electron/osx-sign").signAsync({
    ...options,
    identity: "-",
    identityValidation: false,
    keychain: undefined,
    provisioningProfile: undefined,
    preEmbedProvisioningProfile: false,
  });
}

async function withOfflineMacSigning(
  mode,
  platform,
  action,
  environment = process.env,
) {
  if (mode !== "offline" || platform !== "darwin") return action();
  // The pinned builder skips even ad-hoc signatures on PRs. Permit this local
  // signature only while no release certificate or notarization credentials exist.
  const keys = new Set([
    ...Object.keys(environment).filter((key) => /^(CSC_|APPLE_)/i.test(key)),
    "CSC_FOR_PULL_REQUEST",
    "CSC_IDENTITY_AUTO_DISCOVERY",
  ]);
  const previous = new Map([...keys].map((key) => [key, environment[key]]));
  for (const key of keys) delete environment[key];
  environment.CSC_FOR_PULL_REQUEST = "true";
  environment.CSC_IDENTITY_AUTO_DISCOVERY = "false";
  try {
    return await action();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete environment[key];
      else environment[key] = value;
    }
  }
}

function packageConfiguration(mode, appVersion = "dev") {
  const buildConfig = require("../electron-builder.config.cjs");
  return {
    ...buildConfig,
    // Electron requires a semver package version; the game's identity is separate.
    extraMetadata: { ...buildConfig.extraMetadata, appVersion },
    win: {
      ...buildConfig.win,
      // Steam releases embed the game's icon/version and use configured release signing.
      signAndEditExecutable: mode === "steam",
    },
    mac: {
      ...buildConfig.mac,
      // Ad-hoc signing keeps Apple Silicon's native code signatures valid without Apple
      // credentials. Release builds retain Developer ID discovery and notarization.
      ...(mode === "offline"
        ? { identity: "-", notarize: false, sign: signMacAdHoc }
        : {}),
    },
  };
}

async function desktopPackage() {
  const value = (flag, fallback) => {
    const index = process.argv.indexOf(flag);
    return index < 0 ? fallback : process.argv[index + 1];
  };
  const mode = value("--mode", "steam");
  const appId = Number(process.env.STEAM_APP_ID);
  if (!["offline", "steam"].includes(mode))
    throw new Error("Use --mode steam or --mode offline");
  if (
    mode === "steam" &&
    (!Number.isSafeInteger(appId) || appId <= 0 || appId > 2147483647)
  )
    throw new Error(
      "Set STEAM_APP_ID to Electrify's actual Steamworks App ID before making a Steam depot build. Use desktop:pack:offline for QA without Steam credentials.",
    );
  const platform = value("--platform", process.platform);
  const mac = platform === "darwin";
  const architecture = value("--arch", mac ? "universal" : process.arch);
  if (
    !["win32:x64", "linux:x64", "darwin:universal"].includes(
      `${platform}:${architecture}`,
    )
  )
    throw new Error(
      "Steamworks builds are Windows x64, Linux x64 and one universal macOS app",
    );
  if (
    platform !== process.platform ||
    (mac
      ? !MAC_ARCHITECTURES.includes(process.arch)
      : architecture !== process.arch)
  )
    throw new Error(
      "Build on the target platform (and architecture, for Windows or Linux) with Node 24 and npm ci, so the matching native Steam bridge is installed and verified.",
    );
  if (mac) installMacNativeSlices();
  if (!process.argv.includes("--skip-build")) desktopBuild();
  else if (!fs.existsSync("build/desktop-assets.json"))
    throw new Error("Run desktop:build before --skip-build");
  else {
    verifyEditionBundle("build", "desktop");
    const expected = JSON.parse(
      fs.readFileSync("build/desktop-assets.json", "utf8"),
    );
    if (
      JSON.stringify(verifyBuild("build", "public")) !==
      JSON.stringify(expected)
    )
      throw new Error(
        "Shared desktop renderer differs from its verified manifest",
      );
  }
  fs.writeFileSync(
    "desktop-config.json",
    JSON.stringify(mode === "steam" ? { mode, appId } : { mode }, null, 2) +
      "\n",
  );
  const target = {
    win32: builder.Platform.WINDOWS,
    linux: builder.Platform.LINUX,
    darwin: builder.Platform.MAC,
  }[platform];
  await withOfflineMacSigning(mode, platform, () =>
    builder.build({
      targets: target.createTarget(
        ["dir"],
        mac ? builder.Arch.universal : builder.Arch.x64,
      ),
      config: {
        ...packageConfiguration(
          mode,
          JSON.parse(fs.readFileSync("build/package.json", "utf8")).version,
        ),
        afterPack: (context) => {
          // Check every asset and exact native SDK/FFI byte before a signer can update
          // Mach-O signatures, including ad-hoc signatures in macOS offline QA builds.
          verifyPackaged(context.appOutDir);
        },
      },
    }),
  );
  const output =
    platform === "win32"
      ? "win-unpacked"
      : platform === "linux"
        ? "linux-unpacked"
        : "mac-universal";
  const directory = path.join("dist", "desktop", output);
  // Check the finished signature once, after all packaging has completed. An afterSign hook
  // also fires when the pinned builder skips signing, so it cannot establish signature validity.
  const count =
    platform === "darwin"
      ? verifySignedMacPackage(directory)
      : verifyPackaged(directory);
  console.error(
    `Packaged desktop verified: ${count} assets, native Steam runtime, and offline game.`,
  );
}
if (require.main === module)
  desktopPackage().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });

module.exports = {
  installMacNativeSlices,
  packageConfiguration,
  desktopPackage,
  withOfflineMacSigning,
  signMacAdHoc,
};
