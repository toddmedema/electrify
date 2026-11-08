const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

// Ubuntu 22.04's NSS/NSPR runtime, including dlopen modules. Keep glibc, graphics,
// audio and driver libraries owned by Steam's runtime instead of copying the host.
const LIBRARIES = [
  "libnss3.so",
  "libnssutil3.so",
  "libsmime3.so",
  "libssl3.so",
  "libnspr4.so",
  "libplc4.so",
  "libplds4.so",
  "libsoftokn3.so",
  "libfreebl3.so",
  "libfreeblpriv3.so",
  "libnssckbi.so",
  "libnssdbm3.so",
  "libsqlite3.so.0",
];
const CHECKSUMS = [
  "libfreebl3.chk",
  "libfreeblpriv3.chk",
  "libsoftokn3.chk",
  "libnssdbm3.chk",
];
const NOTICES = ["libnss3", "libnspr4", "libsqlite3-0"];
const LICENSES = ["MPL-2.0", "LGPL-2.1", "GPL-2"];
const launcher = `#!/bin/sh
set -eu
depot_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export LD_LIBRARY_PATH="$depot_dir/lib\${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$depot_dir/Electrify.bin" "$@"
`;
const digest = (bytes) =>
  crypto.createHash("sha256").update(bytes).digest("hex");

function bundleLinuxRuntime(
  directory,
  {
    libraryDirectory = "/usr/lib/x86_64-linux-gnu",
    noticeDirectory = "/usr/share/doc",
    licenseDirectory = "/usr/share/common-licenses",
  } = {},
) {
  const target = path.join(directory, "lib");
  fs.mkdirSync(target, { recursive: true });
  const records = [];
  for (const name of [...LIBRARIES, ...CHECKSUMS]) {
    const direct = path.join(libraryDirectory, name);
    const bytes = fs.readFileSync(
      fs.existsSync(direct) ? direct : path.join(libraryDirectory, "nss", name),
    );
    if (
      LIBRARIES.includes(name) &&
      bytes.subarray(0, 4).toString() !== "\x7fELF"
    )
      throw new Error(`Linux runtime library is not ELF: ${name}`);
    fs.writeFileSync(path.join(target, name), bytes);
    records.push({ name, sha256: digest(bytes) });
  }
  for (const name of NOTICES) {
    const bytes = fs.readFileSync(
      path.join(noticeDirectory, name, "copyright"),
    );
    if (!bytes.toString().trim())
      throw new Error(`Missing Linux runtime notice: ${name}`);
    fs.writeFileSync(path.join(target, `${name}.copyright`), bytes);
    records.push({ name: `${name}.copyright`, sha256: digest(bytes) });
  }
  for (const name of LICENSES) {
    const bytes = fs.readFileSync(path.join(licenseDirectory, name));
    fs.writeFileSync(path.join(target, name), bytes);
    records.push({ name, sha256: digest(bytes) });
  }
  fs.writeFileSync(
    path.join(target, "manifest.json"),
    JSON.stringify(records) + "\n",
  );
  fs.renameSync(
    path.join(directory, "Electrify"),
    path.join(directory, "Electrify.bin"),
  );
  fs.writeFileSync(path.join(directory, "Electrify"), launcher, {
    mode: 0o755,
  });
}

function verifyLinuxRuntime(directory, checkDependencies = true) {
  const target = path.join(directory, "lib");
  const records = JSON.parse(
    fs.readFileSync(path.join(target, "manifest.json"), "utf8"),
  );
  const expected = [
    ...LIBRARIES,
    ...CHECKSUMS,
    ...NOTICES.map((name) => `${name}.copyright`),
    ...LICENSES,
  ];
  if (
    JSON.stringify(records.map((entry) => entry.name)) !==
    JSON.stringify(expected)
  )
    throw new Error("Incomplete Linux runtime manifest");
  for (const entry of records)
    if (digest(fs.readFileSync(path.join(target, entry.name))) !== entry.sha256)
      throw new Error(`Packaged Linux runtime mismatch: ${entry.name}`);
  if (
    fs.readFileSync(path.join(directory, "Electrify"), "utf8") !== launcher ||
    !(fs.statSync(path.join(directory, "Electrify")).mode & 0o111) ||
    !fs.existsSync(path.join(directory, "Electrify.bin"))
  )
    throw new Error("Linux runtime launcher is missing or changed");
  if (checkDependencies) {
    for (const filename of [
      "Electrify.bin",
      ...LIBRARIES.map((name) => `lib/${name}`),
    ]) {
      const result = execFileSync("ldd", [path.resolve(directory, filename)], {
        encoding: "utf8",
        env: { ...process.env, LD_LIBRARY_PATH: path.resolve(target) },
      });
      if (/not found/.test(result))
        throw new Error(
          `Unresolved Linux runtime dependency: ${filename}\n${result}`,
        );
      // Prove Electron resolves NSS/NSPR to this depot, even on machines with system copies.
      for (const name of LIBRARIES) {
        const line = result
          .split("\n")
          .find((line) => line.trim().startsWith(`${name} =>`));
        if (line && !line.includes(path.resolve(target, name)))
          throw new Error(`Linux runtime escaped the depot: ${name}`);
      }
    }
  }
}
module.exports = {
  bundleLinuxRuntime,
  verifyLinuxRuntime,
  LIBRARIES,
  CHECKSUMS,
  NOTICES,
  LICENSES,
};
