const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const {
  bundleLinuxRuntime,
  verifyLinuxRuntime,
  LIBRARIES,
  CHECKSUMS,
  NOTICES,
  LICENSES,
} = require("../scripts/linux-runtime");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "electrify linux "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const libraries = path.join(root, "system", "lib");
  const notices = path.join(root, "system", "doc");
  const licenses = path.join(root, "system", "licenses");
  const depot = path.join(root, "game depot");
  fs.mkdirSync(path.join(libraries, "nss"), { recursive: true });
  fs.mkdirSync(depot);
  fs.mkdirSync(licenses);
  for (const name of LICENSES)
    fs.writeFileSync(path.join(licenses, name), name);
  for (const name of [...LIBRARIES, ...CHECKSUMS]) {
    // Ubuntu keeps its dynamically loaded modules in a separate nss directory.
    const directory = /softokn|nssckbi|nssdbm/.test(name)
      ? path.join(libraries, "nss")
      : libraries;
    fs.writeFileSync(path.join(directory, name), `\x7fELF-${name}`);
  }
  for (const name of NOTICES) {
    fs.mkdirSync(path.join(notices, name), { recursive: true });
    fs.writeFileSync(
      path.join(notices, name, "copyright"),
      `License for ${name}`,
    );
  }
  fs.writeFileSync(
    path.join(depot, "Electrify"),
    '#!/bin/sh\nprintf "%s\\n" "$LD_LIBRARY_PATH" "$ELECTRIFY_RUNTIME_LIB" "$@"\n',
    { mode: 0o755 },
  );
  return {
    root,
    depot,
    libraries,
    options: {
      libraryDirectory: libraries,
      noticeDirectory: notices,
      licenseDirectory: licenses,
    },
  };
}

test(
  "Linux depot includes NSS, NSPR, modules, checksums and notices and launches with bundled libraries",
  { skip: process.platform === "win32" },
  (t) => {
    const f = fixture(t);
    bundleLinuxRuntime(f.depot, f.options);
    verifyLinuxRuntime(f.depot, false);
    // It must still launch after the build machine's library tree disappears.
    fs.rmSync(f.libraries, { recursive: true });
    for (const previous of [undefined, "/steam/runtime/lib"]) {
      const env = { ...process.env, SteamAppId: "1234" };
      if (previous) env.LD_LIBRARY_PATH = previous;
      else delete env.LD_LIBRARY_PATH;
      const lines = execFileSync(
        path.join(f.depot, "Electrify"),
        ["two words", "+connect_lobby", "109775242999999999"],
        { env, encoding: "utf8" },
      )
        .trim()
        .split("\n");
      assert.deepEqual(lines, [
        path.join(f.depot, "lib") + (previous ? `:${previous}` : ""),
        path.join(f.depot, "lib"),
        "two words",
        "+connect_lobby",
        "109775242999999999",
      ]);
    }
    fs.writeFileSync(path.join(f.depot, "lib", "libnss3.so"), "broken");
    assert.throws(
      () => verifyLinuxRuntime(f.depot, false),
      /runtime mismatch: libnss3/,
    );
  },
);

test(
  "A direct NixOS launch uses the Nix runtime and forwards the Electron arguments",
  { skip: process.platform === "win32" },
  (t) => {
    const { root, depot, options } = fixture(t);
    bundleLinuxRuntime(depot, options);
    const launcher = path.join(depot, "Electrify");
    const osRelease = path.join(root, "os-release");
    const hostEtc = path.join(root, "host-etc");
    // Exercise the packaged shell script with a simulated host filesystem.
    fs.writeFileSync(osRelease, "ID=nixos\n");
    fs.writeFileSync(
      launcher,
      fs
        .readFileSync(launcher, "utf8")
        .replace("/etc/os-release", osRelease)
        .replaceAll("/.host-etc", hostEtc),
    );
    const bin = path.join(root, "bin");
    const runtime = path.join(root, "nix runtime");
    fs.mkdirSync(bin);
    fs.mkdirSync(path.join(runtime, "bin"), { recursive: true });
    fs.writeFileSync(
      path.join(bin, "nix-build"),
      '#!/bin/sh\n[ "$1" = --no-out-link ] && [ -r "$2" ] || exit 2\nprintf "%s\\n" "$TEST_RUNTIME"\n',
      { mode: 0o755 },
    );
    fs.writeFileSync(
      path.join(runtime, "bin", "electrify-nixos"),
      '#!/bin/sh\nprintf "nix runtime\\n"\nexec "$@"\n',
      { mode: 0o755 },
    );
    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      TEST_RUNTIME: runtime,
      SteamAppId: "",
      LD_LIBRARY_PATH: "/host/lib",
    };
    delete env.ELECTRIFY_RUNTIME_LIB;
    const args = ["--version", "two words", "$literal"];
    const launch = (environment = env) =>
      execFileSync(launcher, args, { env: environment, encoding: "utf8" })
        .trim()
        .split("\n");
    assert.deepEqual(launch(), ["nix runtime", "/host/lib", "", ...args]);

    const lib = path.join(depot, "lib");
    const direct = [`${lib}:/host/lib`, lib, ...args];
    assert.deepEqual(launch({ ...env, SteamAppId: "1234" }), direct);
    fs.mkdirSync(hostEtc);
    assert.deepEqual(launch(), direct);
    fs.rmdirSync(hostEtc);

    fs.writeFileSync(path.join(bin, "nix-build"), "#!/bin/sh\nexit 2\n");
    const failed = spawnSync(launcher, args, { env, encoding: "utf8" });
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /Electrify.*NixOS runtime.*<nixpkgs>/);
    assert.equal(failed.stdout, "");
  },
);

test("Linux packaging refuses missing NSS inputs instead of shipping a partial depot", (t) => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.libraries, "libnspr4.so"));
  assert.throws(() => bundleLinuxRuntime(f.depot, f.options), /ENOENT/);
  assert.equal(fs.existsSync(path.join(f.depot, "Electrify.bin")), false);
});
