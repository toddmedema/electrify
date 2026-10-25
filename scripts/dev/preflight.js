const fs = require("node:fs");
const path = require("node:path");
const { isDeepStrictEqual } = require("node:util");

function fail(message) {
  throw new Error(`Dependency preflight failed: ${message}. Run npm ci.`);
}

function read(root, name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
  } catch {
    fail(`${name} is missing or invalid`);
  }
}

function permits(allowed, current) {
  if (!allowed) return true;
  const values = Array.isArray(allowed) ? allowed : [allowed];
  return (
    !values.includes(`!${current}`) &&
    (!values.some((value) => !value.startsWith("!")) ||
      values.includes(current) ||
      values.includes("any"))
  );
}

function electronRuntime(root, version, platform) {
  if (!version) return "not-required";
  const directory = path.join(root, "node_modules/electron");
  const marker = path.join(directory, "path.txt");
  const dist = path.join(directory, "dist");
  // Electron 44 downloads on demand. A fresh npm ci intentionally has neither
  // marker nor dist; prepare-electron-runtime owns that download before building.
  if (!fs.existsSync(marker) && !fs.existsSync(dist)) return "not-downloaded";
  const executable =
    platform === "darwin"
      ? "Electron.app/Contents/MacOS/Electron"
      : platform === "win32"
        ? "electron.exe"
        : "electron";
  let recorded;
  try {
    recorded = fs.readFileSync(marker, "utf8");
  } catch {
    fail("Electron runtime has no readable path.txt");
  }
  if (recorded !== executable)
    fail("Electron executable path is stale or invalid");
  let installed;
  try {
    installed = fs
      .readFileSync(path.join(dist, "version"), "utf8")
      .trim()
      .replace(/^v/, "");
  } catch {
    fail("Electron runtime version is missing");
  }
  if (installed !== version)
    fail("Electron runtime version differs from lockfile");
  try {
    if (!fs.statSync(path.join(dist, executable)).isFile()) throw new Error();
  } catch {
    fail("Electron executable is missing");
  }
  return "ready";
}

/** Read-only local full-install check. CI's deliberately trimmed install is checked
 * by its own profile and must not enter this function. This verifies npm metadata
 * and installed versions, not the contents of every dependency's source file. */
function checkDependencies(
  root = process.cwd(),
  {
    nodeVersion = process.versions.node,
    platform = process.platform,
    arch = process.arch,
    libc = platform === "linux"
      ? process.report.getReport().header.glibcVersionRuntime
        ? "glibc"
        : "musl"
      : undefined,
  } = {},
) {
  if (!/^v?24\./.test(nodeVersion))
    throw new Error("Use Node 24 for Electrify");
  const lock = read(root, "package-lock.json");
  const installed = read(root, "node_modules/.package-lock.json");
  if (
    lock.lockfileVersion !== 3 ||
    installed.lockfileVersion !== 3 ||
    !lock.packages?.[""] ||
    !installed.packages
  )
    fail("unsupported or mismatched lockfile format");
  const pkg = read(root, "package.json");
  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
  ])
    if (!isDeepStrictEqual(pkg[field] || {}, lock.packages[""][field] || {}))
      fail(
        `package.json ${field} differ from lockfile; update the lockfile intentionally`,
      );
  let packages = 0;
  for (const [name, entry] of Object.entries(lock.packages)) {
    if (!name) continue;
    if (!name.startsWith("node_modules/") || name.split(/[\\/]/).includes(".."))
      fail(`unsupported package location ${name}`);
    if (entry.link) fail(`unsupported linked package ${name}`);
    const compatible =
      permits(entry.os, platform) &&
      permits(entry.cpu, arch) &&
      permits(entry.libc, libc);
    if (!compatible) {
      if (entry.optional) continue;
      fail(`${name} is incompatible with ${platform}/${arch}`);
    }
    const metadata = installed.packages[name];
    if (!metadata) fail(`${name} is missing from installed lockfile`);
    for (const field of ["version", "resolved", "integrity"])
      if (metadata[field] !== entry[field])
        fail(`${name} ${field} differs from lockfile`);
    if (read(root, `${name}/package.json`).version !== entry.version)
      fail(`${name} installed version differs from lockfile`);
    packages++;
  }
  for (const name of Object.keys(installed.packages))
    if (name && !lock.packages[name])
      fail(`${name} is not in the current lockfile`);
  return {
    packages,
    electronRuntime: electronRuntime(
      root,
      lock.packages["node_modules/electron"]?.version,
      platform,
    ),
  };
}

module.exports = { checkDependencies };
