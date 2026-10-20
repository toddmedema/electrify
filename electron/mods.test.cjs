const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ModStore, readPackage } = require("./mods.cjs");
const { parseMod, MAX_MOD_BYTES } = require("../src/data/ModSchema.js");
const fixture = () => ({
  schemaVersion: 1,
  id: "test-grid",
  title: "Test Grid",
  creator: "Test Creator",
  version: "1",
  rules: "rules-test",
  seed: 42,
  baseScenarioId: 999,
});
function setup(t, workshop) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "electrify-mod-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "scenario.json");
  fs.writeFileSync(file, JSON.stringify(fixture()));
  return {
    root,
    file,
    store: new ModStore(root, () => workshop, "rules-test"),
  };
}
test("strict data-only parser rejects scripts, unknown fields, excessive sizes and unsafe economics", () => {
  assert.deepEqual(parseMod(JSON.stringify(fixture())), fixture());
  for (const patch of [
    { script: "evil()" },
    { id: "../escape" },
    { id: 123 },
    { facilities: { Solar: { buildCost: -1 } } },
    { programs: { solar: Infinity } },
    { scenario: { startingYear: 1700 } },
    { scenario: { eventScenarioIds: [100, 100] } },
    { notifications: [{ month: 0, title: "bad", message: "bad" }] },
    { seed: 1.5 },
  ])
    assert.throws(() => parseMod(JSON.stringify({ ...fixture(), ...patch })));
  assert.throws(() => parseMod(" ".repeat(MAX_MOD_BYTES + 1)));
  assert.throws(() =>
    parseMod(
      JSON.stringify(fixture()).replace(
        '"seed":42',
        '"__proto__":{},"seed":42',
      ),
    ),
  );
});
test("imports persist offline, enable state survives updates, removal leaves snapshots intact", async (t) => {
  const { root, file, store } = setup(t);
  const first = await store.request({ kind: "import" }, async () => file);
  const snapshot = structuredClone(first.entries[0].pack);
  await store.request({
    kind: "enable",
    key: "local:test-grid",
    enabled: false,
  });
  fs.writeFileSync(file, JSON.stringify({ ...fixture(), version: "2" }));
  await store.request({ kind: "import" }, async () => file);
  const restored = new ModStore(root).read();
  assert.equal(restored[0].enabled, false);
  assert.equal(restored[0].pack.version, "2");
  await store.request({ kind: "remove", key: "local:test-grid" });
  assert.deepEqual(store.read(), []);
  assert.equal(snapshot.version, "1");
});
test("symlinks and malformed updates cannot replace installed content", async (t) => {
  const { root, file, store } = setup(t);
  await store.request({ kind: "import" }, async () => file);
  const link = path.join(root, "link.json");
  fs.symlinkSync(file, link);
  assert.throws(() => readPackage(link));
  fs.writeFileSync(file, '{"schemaVersion":999}');
  await assert.rejects(store.request({ kind: "import" }, async () => file));
  assert.equal(store.read()[0].pack.version, "1");
});
test("refresh copies only installed data, works offline afterward, and unsubscribe is transactional", async (t) => {
  let connected = true;
  let subscribed = ["123"];
  const workshop = {
    subscribed: () => subscribed,
    installed: () => ({ folder: download, sizeOnDisk: 1000n }),
    subscription: async () => {
      if (!connected) throw new Error("offline");
      subscribed = [];
    },
  };
  const { root, store } = setup(t, workshop);
  const download = path.join(root, "download");
  fs.mkdirSync(download);
  fs.writeFileSync(
    path.join(download, "scenario.json"),
    JSON.stringify(fixture()),
  );
  await store.request({ kind: "refresh" });
  fs.rmSync(download, { recursive: true });
  assert.equal(new ModStore(root).read()[0].pack.title, "Test Grid");
  connected = false;
  await assert.rejects(store.request({ kind: "remove", key: "workshop:123" }));
  assert.equal(store.read().length, 1);
  connected = true;
  await store.request({ kind: "remove", key: "workshop:123" });
  assert.equal(store.read().length, 0);
});
test("publishing retries update the same created item and upload only the validated package", async (t) => {
  let creates = 0,
    uploads = 0;
  const workshop = {
    create: async () => {
      creates++;
      return { id: "456", agreement: false };
    },
    publish: async (id, pack, stage) => {
      uploads++;
      assert.equal(id, "456");
      assert.deepEqual(fs.readdirSync(stage), ["scenario.json"]);
      assert.deepEqual(readPackage(path.join(stage, "scenario.json")), pack);
      if (uploads === 1) throw new Error("upload failed");
      return { id, agreement: true };
    },
  };
  const { file, store } = setup(t, workshop);
  await store.request({ kind: "import" }, async () => file);
  await assert.rejects(
    store.request({ kind: "publish", key: "local:test-grid" }),
  );
  const result = await store.request({
    kind: "publish",
    key: "local:test-grid",
  });
  assert.equal(creates, 1);
  assert.equal(uploads, 2);
  assert.match(result.message, /agreement/);
  const retained = fs
    .readdirSync(store.directory)
    .filter((f) => f.startsWith("upload-"));
  assert.equal(retained.length, 1);
  assert.deepEqual(
    readPackage(path.join(store.directory, retained[0], "scenario.json")),
    fixture(),
  );
});

test("native publishing rejects missing or incompatible trusted rules before reaching Steam", async (t) => {
  for (const rules of [undefined, "rules-other"]) {
    const { root, file, store } = setup(t);
    await store.request({ kind: "import" }, async () => file);
    const guarded = new ModStore(
      root,
      () => assert.fail("must reject before reaching Steam"),
      rules,
    );
    await assert.rejects(
      guarded.request({ kind: "publish", key: "local:test-grid" }),
      /installed game rules/,
    );
  }
});
