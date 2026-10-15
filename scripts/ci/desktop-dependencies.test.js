const { test } = require("node:test");
const assert = require("node:assert/strict");
const { trimLock, profileFiles } = require("./desktop-dependencies");

test("native installs retain every runtime dependency and the exact original locked records", () => {
  const pkg = require("../../package.json");
  const original = require("../../package-lock.json");
  const profile = profileFiles(pkg, original);
  assert.deepEqual(profile.pkg.dependencies, pkg.dependencies);
  assert.deepEqual(
    profile.lock.packages[""].dependencies,
    original.packages[""].dependencies,
  );
  assert.deepEqual(Object.keys(profile.pkg.devDependencies).sort(), [
    "@playwright/test",
    "electron-builder",
    "prettier",
    "typescript",
  ]);
  assert.equal(profile.lock.packages["node_modules/react-scripts"], undefined);
  for (const [key, entry] of Object.entries(profile.lock.packages)) {
    if (key !== "") assert.deepEqual(entry, original.packages[key], key);
  }
  assert(
    Object.keys(profile.lock.packages).length <
      Object.keys(original.packages).length / 2,
  );
});

test("lock trimming preserves nested resolutions, peers and platform-specific optional modules", () => {
  const root = { dependencies: { runtime: "1" }, devDependencies: { qa: "1" } };
  const lock = {
    lockfileVersion: 3,
    packages: {
      "": root,
      "node_modules/runtime": {
        version: "1",
        dependencies: { core: "2" },
        optionalDependencies: { native: "1", missing: "1" },
      },
      "node_modules/runtime/node_modules/core": {
        version: "2",
        integrity: "nested-integrity",
      },
      "node_modules/qa": {
        version: "1",
        peerDependencies: { core: "1", optionalPeer: "1" },
        peerDependenciesMeta: { optionalPeer: { optional: true } },
      },
      "node_modules/core": { version: "1", integrity: "hoisted-integrity" },
      "node_modules/native": {
        version: "1",
        optional: true,
        os: ["darwin"],
        cpu: ["arm64"],
      },
      "node_modules/unused": { version: "99" },
    },
  };
  const reduced = trimLock(lock, root);
  assert.equal(reduced.packages["node_modules/unused"], undefined);
  for (const key of Object.keys(lock.packages).filter(
    (key) => !key.endsWith("unused"),
  ))
    assert.deepEqual(reduced.packages[key], lock.packages[key]);
  assert.throws(
    () => trimLock(lock, { dependencies: { absent: "1" } }),
    /Missing locked dependency/,
  );
});
