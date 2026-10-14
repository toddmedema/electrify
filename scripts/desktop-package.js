const fs = require("node:fs");
const path = require("node:path");
const builder = require("electron-builder");
const { desktopBuild } = require("./desktop-build");
const { verifyPackaged, verifySignedMacPackage } = require("./desktop-verify");

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

function packageConfiguration(mode) {
  const buildConfig = require("../electron-builder.config.cjs");
  return {
    ...buildConfig,
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
  const architecture = value("--arch", process.arch);
  if (
    !["win32:x64", "linux:x64", "darwin:x64", "darwin:arm64"].includes(
      `${platform}:${architecture}`,
    )
  )
    throw new Error(
      "Steamworks supports Windows/Linux x64 and macOS x64/arm64 builds",
    );
  if (platform !== process.platform || architecture !== process.arch)
    throw new Error(
      "Build on the target platform and architecture with Node 24 and npm ci, so the matching native Steam bridge is installed and verified.",
    );
  if (!process.argv.includes("--skip-build")) desktopBuild();
  else if (!fs.existsSync("build/desktop-assets.json"))
    throw new Error("Run desktop:build before --skip-build");
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
  let signedMac = false;
  await withOfflineMacSigning(mode, platform, () =>
    builder.build({
      targets: target.createTarget(
        ["dir"],
        architecture === "arm64" ? builder.Arch.arm64 : builder.Arch.x64,
      ),
      config: {
        ...packageConfiguration(mode),
        afterPack: (context) => {
          // Check every asset and exact native SDK/FFI byte before a signer can update
          // Mach-O signatures, including ad-hoc signatures in macOS offline QA builds.
          verifyPackaged(context.appOutDir);
        },
        afterSign: (context) => {
          if (platform === "darwin") {
            verifySignedMacPackage(context.appOutDir);
            signedMac = true;
          }
        },
      },
    }),
  );
  const output =
    platform === "win32"
      ? "win-unpacked"
      : platform === "linux"
        ? "linux-unpacked"
        : architecture === "arm64"
          ? "mac-arm64"
          : "mac";
  const directory = path.join("dist", "desktop", output);
  const count = signedMac
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
  packageConfiguration,
  desktopPackage,
  withOfflineMacSigning,
  signMacAdHoc,
};
