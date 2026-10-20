const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ModStore } = require("./mods.cjs");
const pack = {
  schemaVersion: 1,
  id: "review-grid",
  title: "Review",
  creator: "Creator",
  version: "1",
  rules: "rules-test",
  seed: 42,
  baseScenarioId: 999,
};
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "electrify-mod-review-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
test("a corrupt library recovers its last completed transaction without deleting evidence", (t) => {
  const store = new ModStore(setup(t));
  store.write([
    { key: "local:review-grid", source: "local", enabled: true, pack },
  ]);
  store.write([]);
  fs.writeFileSync(store.filename, "broken JSON");
  assert.equal(store.read()[0].pack.title, "Review");
  assert.equal(fs.readFileSync(store.filename, "utf8"), "broken JSON");
  fs.writeFileSync(`${store.filename}.previous`, "also broken");
  assert.throws(() => store.read(), /preserved/);
});
test("startup cleans old upload stages, but opening another store preserves current uploads", (t) => {
  const root = setup(t);
  const stage = path.join(root, "mods", "upload-old123");
  fs.mkdirSync(stage, { recursive: true });
  fs.writeFileSync(path.join(stage, "scenario.json"), JSON.stringify(pack));
  new ModStore(root);
  assert.equal(fs.existsSync(stage), false);
  fs.mkdirSync(stage);
  new ModStore(root);
  assert.equal(fs.existsSync(stage), true);
});
test("unfinished uploads have a bounded disk footprint before any new Steam item is created", async (t) => {
  const store = new ModStore(
    setup(t),
    () => ({
      create: () => assert.fail("must not create"),
    }),
    "rules-test",
  );
  store.write([
    { key: "local:review-grid", source: "local", enabled: true, pack },
  ]);
  for (let i = 0; i < 32; i++)
    fs.mkdirSync(path.join(store.directory, `upload-${i}`));
  await assert.rejects(
    store.request({ kind: "publish", key: "local:review-grid" }),
    /Restart Electrify/,
  );
});
