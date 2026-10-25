const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { checkDependencies } = require("../dev/preflight");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "electrify-preflight-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, value) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      typeof value === "string" ? value : JSON.stringify(value),
    );
  };
  const packages = {
    "": { name: "fixture", dependencies: { runtime: "1.2.3" } },
    "node_modules/runtime": {
      version: "1.2.3",
      resolved: "https://example.test/runtime.tgz",
      integrity: "sha512-runtime",
    },
    "node_modules/runtime/node_modules/nested": {
      version: "2.0.0",
      integrity: "sha512-nested",
    },
    "node_modules/dev-tool": { version: "3.0.0", dev: true },
    "node_modules/electron": { version: "44.9.1", dev: true },
  };
  const lock = { lockfileVersion: 3, packages };
  const installed = {
    lockfileVersion: 3,
    packages: structuredClone(
      Object.fromEntries(Object.entries(packages).filter(([name]) => name)),
    ),
  };
  const save = () => {
    write("package-lock.json", lock);
    write("node_modules/.package-lock.json", installed);
  };
  write("package.json", packages[""]);
  save();
  for (const [name, entry] of Object.entries(installed.packages))
    write(`${name}/package.json`, { version: entry.version });
  const runtime = () => {
    write(
      "node_modules/electron/path.txt",
      "Electron.app/Contents/MacOS/Electron",
    );
    write("node_modules/electron/dist/version", "44.9.1");
    write(
      "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
      "binary fixture",
    );
  };
  const verify = () =>
    checkDependencies(root, {
      nodeVersion: "24.14.0",
      platform: "darwin",
      arch: "arm64",
    });
  return { root, write, lock, installed, save, runtime, verify };
}

test("preflight accepts the exact full install, including a pristine lazy Electron runtime", (t) => {
  const { verify, runtime } = fixture(t);
  assert.deepEqual(verify(), {
    packages: 4,
    electronRuntime: "not-downloaded",
  });
  runtime();
  assert.deepEqual(verify(), { packages: 4, electronRuntime: "ready" });
});

test("preflight rejects unsupported Node and missing install metadata before work starts", (t) => {
  const { root, verify } = fixture(t);
  assert.throws(
    () => checkDependencies(root, { nodeVersion: "22.14.0" }),
    /Node 24/,
  );
  fs.rmSync(path.join(root, "node_modules/.package-lock.json"));
  assert.throws(verify, /node_modules.*package-lock.*npm ci/);
});

for (const field of [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
]) {
  test(`preflight rejects changed package.json ${field} before trusting the installed lockfile`, (t) => {
    const { write, lock, verify } = fixture(t);
    const pkg = structuredClone(lock.packages[""]);
    pkg[field] = { ...pkg[field], added: "^9.0.0" };
    write("package.json", pkg);
    assert.throws(
      verify,
      new RegExp(`package.json ${field}.*lockfile.*npm ci`),
    );
    write("package.json", lock.packages[""]);
    assert.equal(verify().packages, 4);
  });
}

for (const field of ["version", "integrity", "resolved"]) {
  test(`preflight rejects an install whose ${field} no longer matches the lockfile`, (t) => {
    const { lock, save, verify } = fixture(t);
    lock.packages["node_modules/runtime"][field] = "changed";
    save();
    assert.throws(verify, new RegExp(`node_modules/runtime.*${field}.*npm ci`));
  });
}

test("preflight checks actual package versions and missing nested or development dependencies", (t) => {
  const { root, write, verify } = fixture(t);
  write("node_modules/dev-tool/package.json", { version: "2.9.0" });
  assert.throws(verify, /dev-tool.*installed version.*npm ci/);
  write("node_modules/dev-tool/package.json", { version: "3.0.0" });
  fs.rmSync(
    path.join(root, "node_modules/runtime/node_modules/nested/package.json"),
  );
  assert.throws(verify, /runtime\/node_modules\/nested.*package.json.*npm ci/);
});

test("preflight rejects omitted required metadata, extra installed packages and lock-format changes", (t) => {
  const { installed, save, verify } = fixture(t);
  const expected = installed.packages["node_modules/dev-tool"];
  delete installed.packages["node_modules/dev-tool"];
  save();
  assert.throws(verify, /dev-tool.*missing.*npm ci/);
  installed.packages["node_modules/dev-tool"] = expected;
  installed.packages["node_modules/stale"] = { version: "0.1.0" };
  save();
  assert.throws(verify, /stale.*not in.*lockfile.*npm ci/);
  delete installed.packages["node_modules/stale"];
  installed.lockfileVersion = 2;
  save();
  assert.throws(verify, /lockfile format.*npm ci/);
});

test("preflight skips optional packages for other OS, CPU and libc targets, but not this target", (t) => {
  const { lock, installed, save, write, verify } = fixture(t);
  Object.assign(lock.packages, {
    "node_modules/windows": { version: "1", optional: true, os: ["win32"] },
    "node_modules/intel": { version: "1", optional: true, cpu: ["x64"] },
    "node_modules/not-mac": { version: "1", optional: true, os: ["!darwin"] },
    "node_modules/linux-musl": {
      version: "1",
      optional: true,
      os: ["linux"],
      libc: ["musl"],
    },
  });
  save();
  assert.equal(verify().packages, 4);
  lock.packages["node_modules/mac"] = {
    version: "1",
    optional: true,
    os: ["darwin"],
    cpu: ["arm64"],
  };
  save();
  assert.throws(verify, /node_modules\/mac.*missing.*npm ci/);
  installed.packages["node_modules/mac"] = structuredClone(
    lock.packages["node_modules/mac"],
  );
  write("node_modules/mac/package.json", { version: "1" });
  save();
  assert.equal(verify().packages, 5);
});

test("preflight fails closed for incompatible required packages and unsupported linked records", (t) => {
  const { lock, save, verify } = fixture(t);
  lock.packages["node_modules/runtime"].os = ["win32"];
  save();
  assert.throws(verify, /runtime.*incompatible/);
  delete lock.packages["node_modules/runtime"].os;
  lock.packages["node_modules/runtime"].link = true;
  save();
  assert.throws(verify, /linked.*runtime/);
});

test("preflight selects the Linux libc package without requiring the other libc", (t) => {
  const { root, lock, installed, save, write } = fixture(t);
  lock.packages["node_modules/native-glibc"] = {
    version: "1",
    optional: true,
    os: ["linux"],
    libc: ["glibc"],
  };
  lock.packages["node_modules/native-musl"] = {
    version: "1",
    optional: true,
    os: ["linux"],
    libc: ["musl"],
  };
  installed.packages["node_modules/native-glibc"] = structuredClone(
    lock.packages["node_modules/native-glibc"],
  );
  write("node_modules/native-glibc/package.json", { version: "1" });
  save();
  assert.equal(
    checkDependencies(root, {
      nodeVersion: "24.14.0",
      platform: "linux",
      arch: "x64",
      libc: "glibc",
    }).packages,
    5,
  );
  assert.throws(
    () =>
      checkDependencies(root, {
        nodeVersion: "24.14.0",
        platform: "linux",
        arch: "x64",
        libc: "musl",
      }),
    /native-musl.*missing.*npm ci/,
  );
});

test("preflight rejects stale or incomplete downloaded Electron runtimes without launching them", (t) => {
  const { root, write, runtime, verify } = fixture(t);
  runtime();
  write("node_modules/electron/dist/version", "44.8.0");
  assert.throws(verify, /Electron runtime version.*npm ci/);
  runtime();
  fs.rmSync(
    path.join(
      root,
      "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
    ),
  );
  assert.throws(verify, /Electron executable.*npm ci/);
  runtime();
  write("node_modules/electron/path.txt", "../outside");
  assert.throws(verify, /Electron executable path.*npm ci/);
  runtime();
  fs.rmSync(path.join(root, "node_modules/electron/path.txt"));
  assert.throws(verify, /Electron.*path.txt.*npm ci/);
});
