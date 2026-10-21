const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  uploadMap,
  verifyExports,
} = require("../../steamworks/achievement-artwork/export.cjs");
const catalog = require("../../src/achievements/AchievementCatalog.json");

test("every live achievement has two correctly named 256px Steam upload icons and current SVG provenance", () => {
  assert.equal(verifyExports(), catalog.length * 2);
});

test("export validation catches missing and incorrectly sized upload files", (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "electrify-achievement-icons-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const entries = [catalog[0]];
  const map = uploadMap(entries);
  fs.mkdirSync(path.join(directory, "uploads"));
  fs.writeFileSync(
    path.join(directory, "upload-map.json"),
    JSON.stringify(map),
  );
  assert.throws(
    () => verifyExports(directory, entries),
    /exactly two upload files/,
  );
  for (const file of [map[0].achieved, map[0].unachieved]) {
    const png = fs.readFileSync(
      path.resolve(__dirname, "../../steamworks/achievement-artwork", file),
    );
    fs.writeFileSync(path.join(directory, file), png);
  }
  assert.equal(verifyExports(directory, entries), 2);
  const bad = fs.readFileSync(path.join(directory, map[0].achieved));
  bad.writeUInt32BE(128, 16);
  fs.writeFileSync(path.join(directory, map[0].achieved), bad);
  assert.throws(
    () => verifyExports(directory, entries),
    /Expected 256px width/,
  );
});

test("export map rejects duplicate API names before they overwrite an upload", () => {
  assert.throws(
    () => uploadMap([catalog[0], catalog[0]]),
    /Duplicate achievement API name/,
  );
});
