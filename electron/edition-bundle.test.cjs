const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { verifyEditionBundle } = require("../scripts/verify-edition-bundle.js");

test("edition gate inspects all lazy chunks and requires the Electron service bundle", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "electrify-bundle-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const manifest = { files: { main: "main.js", lazy: "lazy.js" } };
  const write = () =>
    fs.writeFileSync(
      path.join(root, "asset-manifest.json"),
      JSON.stringify(manifest),
    );
  write();
  fs.writeFileSync(path.join(root, "main.js"), "game");
  fs.writeFileSync(path.join(root, "lazy.js"), "chart");
  assert.throws(() => verifyEditionBundle(root, "web"), /missing/);
  assert.throws(() => verifyEditionBundle(root, "desktop"), /missing/);
  fs.writeFileSync(path.join(root, "lazy.js"), "GRID_GRADUATE");
  verifyEditionBundle(root, "web");
  fs.writeFileSync(
    path.join(root, "lazy.js"),
    "GRID_GRADUATE submitAchievements",
  );
  assert.throws(() => verifyEditionBundle(root, "web"), /leaked/);
  manifest.files.electron = "electron.hash.chunk.js";
  write();
  fs.writeFileSync(
    path.join(root, manifest.files.electron),
    "NIGHT_SHIFT MASTER_OF_THE_GRID submitAchievements",
  );
  verifyEditionBundle(root, "desktop");
  assert.throws(() => verifyEditionBundle(root, "web"), /leaked/);
});
