/* global BigInt */
const fs = require("node:fs");
const path = require("node:path");

const ARM64 = 0x0100000c;
const MACH_O = new Set([
  0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca,
  0xcafebabf, 0xbfbafeca,
]);

function isArm64MachO(bytes) {
  return (
    bytes.length >= 32 &&
    bytes.readUInt32LE(0) === 0xfeedfacf &&
    bytes.readUInt32LE(4) === ARM64
  );
}

/** Read Apple's fat_arch/fat_arch_64 layouts without changing the pinned SDK source. */
function arm64Slice(bytes) {
  if (isArm64MachO(bytes)) return bytes;
  if (bytes.length < 8) throw new Error("Missing ARM64 Mach-O binary");
  const magic = bytes.readUInt32BE(0);
  const little = magic === 0xbebafeca || magic === 0xbfbafeca;
  const wide = magic === 0xcafebabf || magic === 0xbfbafeca;
  if (![0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca].includes(magic))
    throw new Error("Missing ARM64 Mach-O slice");
  const read32 = (offset) =>
    little ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
  const read64 = (offset) =>
    little ? bytes.readBigUInt64LE(offset) : bytes.readBigUInt64BE(offset);
  const count = read32(4),
    entrySize = wide ? 32 : 20;
  if (count > Math.floor((bytes.length - 8) / entrySize))
    throw new Error("Invalid Mach-O architecture table");
  const tableEnd = 8 + count * entrySize;
  let result;
  for (let index = 0; index < count; index++) {
    const entry = 8 + index * entrySize;
    if (read32(entry) !== ARM64) continue;
    const offset = wide ? read64(entry + 8) : BigInt(read32(entry + 8));
    const size = wide ? read64(entry + 16) : BigInt(read32(entry + 12));
    if (
      result ||
      offset < BigInt(tableEnd) ||
      size < 32n ||
      offset + size > BigInt(bytes.length)
    )
      throw new Error("Invalid ARM64 Mach-O slice bounds");
    result = bytes.subarray(Number(offset), Number(offset + size));
    if (!isArm64MachO(result)) throw new Error("Invalid ARM64 Mach-O slice");
  }
  if (!result) throw new Error("Missing ARM64 Mach-O slice");
  return result;
}

function prepareMacArm64Package({ electronPlatformName, appOutDir }) {
  if (electronPlatformName !== "darwin") return;
  const sdk = path.join(
    appOutDir,
    "Electrify.app",
    "Contents",
    "Resources",
    "app.asar.unpacked",
    "node_modules",
    "steamworks.js",
    "dist",
    "osx",
    "libsteam_api.dylib",
  );
  fs.writeFileSync(sdk, arm64Slice(fs.readFileSync(sdk)));
}

/** Check every native payload, including Electron helpers, SDK libraries and FFI bindings. */
function verifyMacArm64Package(directory) {
  const application = path.join(directory, "Electrify.app");
  const root = fs.realpathSync(application);
  const executable = path.join(root, "Contents", "MacOS", "Electrify");
  const header = (file) => {
    const fd = fs.openSync(file, "r");
    try {
      const bytes = Buffer.alloc(32);
      return bytes.subarray(0, fs.readSync(fd, bytes, 0, bytes.length, 0));
    } finally {
      fs.closeSync(fd);
    }
  };
  const assertArm64 = (file, bytes) => {
    if (!isArm64MachO(bytes))
      throw new Error(
        `macOS binaries must be ARM64-only: ${path.relative(root, file)}`,
      );
  };
  assertArm64(executable, header(executable));
  const visited = new Set();
  const visit = (file) => {
    const real = fs.realpathSync(file);
    if (real !== root && !real.startsWith(root + path.sep))
      throw new Error(`Mac package symlink leaves the app: ${file}`);
    if (visited.has(real)) return;
    visited.add(real);
    if (fs.statSync(real).isDirectory()) {
      for (const name of fs.readdirSync(real)) visit(path.join(real, name));
    } else {
      const bytes = header(real);
      if (bytes.length >= 4 && MACH_O.has(bytes.readUInt32BE(0)))
        assertArm64(real, bytes);
    }
  };
  visit(root);
}

module.exports = { arm64Slice, prepareMacArm64Package, verifyMacArm64Package };
