const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
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
      const env = { ...process.env };
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

test("Linux packaging refuses missing NSS inputs instead of shipping a partial depot", (t) => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.libraries, "libnspr4.so"));
  assert.throws(() => bundleLinuxRuntime(f.depot, f.options), /ENOENT/);
  assert.equal(fs.existsSync(path.join(f.depot, "Electrify.bin")), false);
});
