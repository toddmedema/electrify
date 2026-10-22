const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ModStore, readPackage, MAX_PACKAGES } = require("./mods.cjs");
const {
  parseMod,
  MAX_MOD_BYTES,
  MOD_API_VERSION,
} = require("../src/mods/ModSchema.js");
const fixture = (patch = {}) => ({
  schemaVersion: 1,
  gameApi: MOD_API_VERSION,
  id: "test-grid",
  title: "Test Grid",
  creator: "Test Creator",
  version: "1",
  seed: 42,
  baseScenarioId: 999,
  ...patch,
});
function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "electrify-mod-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function setup(t, options = {}) {
  const root = temporary(t);
  const file = path.join(root, "scenario.json");
  fs.writeFileSync(file, JSON.stringify(fixture()));
  return {
    root,
    file,
    store: new ModStore(root, {
      chooseFile: async () => file,
      appId: 480,
      ...options,
    }),
  };
}
const entries = async (store) =>
  (await store.request({ kind: "list" })).entries;
function download(root, id, pack = fixture()) {
  const folder = path.join(root, `download-${id}`);
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, "scenario.json"), JSON.stringify(pack));
  return folder;
}

test("strict data-only parser rejects scripts, unknown fields, excessive sizes and unsafe text", () => {
  assert.deepEqual(parseMod(JSON.stringify(fixture())), fixture());
  for (const patch of [
    { script: "evil()" },
    { id: "../escape" },
    { id: "trailing-" },
    { id: 123 },
    { gameApi: 1.5 },
    { facilities: { Solar: { buildCost: -1 } } },
    { programs: { solar: Infinity } },
    { scenario: { startingYear: 1700 } },
    { scenario: { eventScenarioIds: [100, 100] } },
    { notifications: [{ month: 0, title: "bad", message: "bad" }] },
    { seed: 1.5 },
    { title: "Hidden‮txt.exe" },
    { creator: "Zero​width" },
    { version: "C1\u0085control" },
    // 43 three-byte characters fit 100 characters but exceed Steam's 128-byte title limit.
    { title: "電".repeat(43) },
  ])
    assert.throws(() => parseMod(JSON.stringify({ ...fixture(), ...patch })));
  assert.doesNotThrow(() =>
    parseMod(JSON.stringify(fixture({ title: "電".repeat(42) }))),
  );
  assert.throws(() => parseMod(" ".repeat(MAX_MOD_BYTES + 1)), /256 KiB/);
  assert.throws(() =>
    parseMod(
      JSON.stringify(fixture()).replace(
        '"seed":42',
        '"__proto__":{},"seed":42',
      ),
    ),
  );
});

test("validation errors name the field and how to fix it", () => {
  const message = (patch) => {
    try {
      parseMod(
        typeof patch === "string" ? patch : JSON.stringify(fixture(patch)),
      );
    } catch (error) {
      return error.message;
    }
    assert.fail("expected a validation error");
  };
  assert.match(
    message({ facilities: { Solr: { buildCost: 0.8 } } }),
    /^facilities\.Solr is not a supported facility\. Use one of: Coal, .*Solar/,
  );
  assert.equal(
    message({ scenario: { startingYear: 1700 } }),
    "scenario.startingYear must be a whole number from 1,980 to 2,100.",
  );
  assert.match(message("{ not json"), /^scenario\.json is not valid JSON \(/);
  assert.equal(
    message({ notifications: [{ month: 2, title: "t" }] }),
    "notifications[0].message is required.",
  );
});

test("import errors return all structured diagnostics", async (t) => {
  const { root, store } = setup(t);
  const filename = path.join(root, "invalid.json");
  fs.writeFileSync(
    filename,
    JSON.stringify(
      fixture({
        facilities: { Solar: { buildCost: 100 } },
        programs: { solar: 0 },
      }),
    ),
  );
  store.chooseFile = async () => filename;
  const result = await store.request({ kind: "import" });
  assert.deepEqual(
    result.diagnostics.map(({ code, path, severity }) => ({
      code,
      path,
      severity,
    })),
    [
      {
        code: "number-bounds",
        path: "facilities.Solar.buildCost",
        severity: "error",
      },
      { code: "number-bounds", path: "programs.solar", severity: "error" },
    ],
  );
  assert.deepEqual(result.entries, []);
});

test("imports persist offline, enable state survives updates, removal leaves snapshots intact", async (t) => {
  const { root, file, store } = setup(t);
  const first = await store.request({ kind: "import" });
  assert.equal(first.message, "Imported Test Grid.");
  assert.equal(first.focusKey, "local:test-grid");
  const snapshot = structuredClone(first.entries[0].pack);
  await store.request({
    kind: "enable",
    key: "local:test-grid",
    enabled: false,
  });
  fs.writeFileSync(file, JSON.stringify(fixture({ version: "2" })));
  assert.equal(
    (await store.request({ kind: "import" })).message,
    "Updated Test Grid.",
  );
  const restored = await entries(new ModStore(root));
  assert.equal(restored[0].enabled, false);
  assert.equal(restored[0].pack.version, "2");
  await store.request({ kind: "remove", key: "local:test-grid" });
  assert.deepEqual(await entries(store), []);
  assert.equal(snapshot.version, "1");
});

test("symlinks and malformed updates cannot replace installed content", async (t) => {
  const { root, file, store } = setup(t);
  await store.request({ kind: "import" });
  const link = path.join(root, "link.json");
  try {
    fs.symlinkSync(file, link);
  } catch (error) {
    // Windows needs administrator rights or developer mode to create symlinks.
    if (error.code !== "EPERM") throw error;
    t.diagnostic("symlink creation is not permitted on this machine");
  }
  if (fs.existsSync(link)) await assert.rejects(readPackage(link));
  fs.writeFileSync(file, '{"schemaVersion":999}');
  const failed = await store.request({ kind: "import" });
  assert.match(failed.error, /schemaVersion must be 1/);
  assert.equal(failed.entries[0].pack.version, "1");
});

test("requests resolve with readable errors instead of rejecting", async (t) => {
  const { store } = setup(t);
  for (const input of [
    undefined,
    { kind: "nope" },
    { kind: "refresh" },
    { kind: "subscribe", id: "123" },
    { kind: "remove", key: "local:missing" },
  ]) {
    const result = await store.request(input);
    assert.equal(typeof result.error, "string");
    assert.doesNotMatch(result.error, /invoking remote method/);
    assert.deepEqual(result.entries, []);
  }
  assert.equal(
    (await store.request({ kind: "refresh" })).error,
    "Workshop needs Steam. Local mods still work offline.",
  );
});

test("refresh copies only installed data, works offline afterward, and unsubscribe is transactional", async (t) => {
  let connected = true;
  let subscribed = ["123"];
  const installed = {};
  const workshop = {
    subscribed: () => subscribed,
    installedOrQueueDownload: () => ({
      folder: installed.folder,
      sizeOnDisk: 1000n,
    }),
    subscription: async () => {
      if (!connected) throw new Error("offline");
      subscribed = [];
    },
  };
  const { root, store } = setup(t, { workshop: () => workshop });
  installed.folder = download(root, "123");
  assert.equal(
    (await store.request({ kind: "refresh" })).message,
    "Installed 1 mod.",
  );
  assert.equal(
    (await store.request({ kind: "refresh" })).message,
    "Workshop mods are up to date.",
  );
  fs.rmSync(installed.folder, { recursive: true });
  assert.equal((await entries(new ModStore(root)))[0].pack.title, "Test Grid");
  connected = false;
  assert.equal(
    (await store.request({ kind: "remove", key: "workshop:123" })).error,
    "offline",
  );
  assert.equal((await entries(store)).length, 1);
  connected = true;
  await store.request({ kind: "remove", key: "workshop:123" });
  assert.equal((await entries(store)).length, 0);
});

test("one bad Workshop item is skipped while good items still install", async (t) => {
  const folders = {};
  const workshop = {
    subscribed: () => ["111", "222", "333"],
    installedOrQueueDownload: (id) =>
      id === "333" ? null : { folder: folders[id], sizeOnDisk: 1000n },
  };
  const { root, store } = setup(t, { workshop: () => workshop });
  folders["111"] = download(root, "111", fixture({ id: "good-grid" }));
  folders["222"] = download(root, "222", fixture({ id: "bad-grid" }));
  fs.writeFileSync(path.join(folders["222"], "script.js"), "evil()");
  const result = await store.request({ kind: "refresh" });
  assert.equal(
    result.message,
    "Installed 1 mod. 1 mod still downloading. They appear when Steam finishes.",
  );
  assert.equal(
    result.warning,
    "Skipped Workshop item 222: not a data-only scenario package.",
  );
  assert.deepEqual(
    result.entries.map((e) => e.key),
    ["workshop:111"],
  );
  // A later broken update keeps the last good copy.
  fs.writeFileSync(path.join(folders["111"], "scenario.json"), "{");
  const again = await store.request({ kind: "refresh" });
  assert.match(
    again.warning,
    /Skipped Workshop item 111: scenario\.json is not valid JSON/,
  );
  assert.equal(again.entries[0].pack.id, "good-grid");
});

test("refresh beyond the install limit installs what fits and explains the rest", async (t) => {
  const ids = Array.from({ length: MAX_PACKAGES + 2 }, (_, i) => String(i + 1));
  const folders = {};
  const workshop = {
    subscribed: () => ids,
    installedOrQueueDownload: (id) => ({ folder: folders[id], sizeOnDisk: 1n }),
  };
  const { root, store } = setup(t, { workshop: () => workshop });
  for (const id of ids)
    folders[id] = download(root, id, fixture({ id: `grid-${id}` }));
  const result = await store.request({ kind: "refresh" });
  assert.equal(result.entries.length, MAX_PACKAGES);
  assert.match(
    result.warning,
    /Electrify can install 32 mods, so 2 subscriptions weren't installed\. Unsubscribe from some on Steam/,
  );
});

test("publishing retries update the same created item, keep it after removal, and upload only the validated package", async (t) => {
  let creates = 0;
  const uploads = [];
  const workshop = {
    create: async () => {
      creates++;
      return { id: "456", agreement: false };
    },
    publish: async (id, pack, stage, options) => {
      uploads.push(options);
      assert.equal(id, "456");
      assert.deepEqual(fs.readdirSync(stage), ["scenario.json"]);
      assert.deepEqual(
        await readPackage(path.join(stage, "scenario.json")),
        pack,
      );
      if (uploads.length === 1) throw new Error("upload failed");
      return { id, agreement: uploads.length === 2 };
    },
  };
  const { store } = setup(t, { workshop: () => workshop });
  await store.request({ kind: "import" });
  const failed = await store.request({
    kind: "publish",
    key: "local:test-grid",
  });
  assert.equal(failed.error, "upload failed");
  // The UI sees the created item immediately, even though the upload failed.
  assert.equal(failed.entries[0].workshopId, "456");
  const result = await store.request({
    kind: "publish",
    key: "local:test-grid",
  });
  assert.equal(
    result.message,
    "Uploaded, but hidden until you accept the Steam Workshop agreement.",
  );
  assert.deepEqual(result.published, { workshopId: "456", agreement: true });
  const retained = fs
    .readdirSync(store.directory)
    .filter((f) => f.startsWith("upload-"));
  assert.equal(retained.length, 1);
  await store.request({ kind: "remove", key: "local:test-grid" });
  await store.request({ kind: "import" });
  const update = await store.request({
    kind: "publish",
    key: "local:test-grid",
  });
  assert.equal(update.message, "Published to Steam Workshop.");
  assert.equal(creates, 1);
  // Visibility is set while the new item has never uploaded, never on later updates.
  assert.deepEqual(
    uploads.map((u) => u.setVisibility),
    [true, true, false],
  );
});

test("publishing rejects packages for another game version before reaching Steam", async (t) => {
  const { file, store } = setup(t, {
    workshop: () => assert.fail("must reject before reaching Steam"),
  });
  fs.writeFileSync(
    file,
    JSON.stringify(fixture({ gameApi: MOD_API_VERSION + 1 })),
  );
  await store.request({ kind: "import" });
  assert.match(
    (await store.request({ kind: "publish", key: "local:test-grid" })).error,
    /current game version/,
  );
});

test("listing never waits behind a slow upload", async (t) => {
  let finish;
  const workshop = {
    create: async () => ({ id: "456", agreement: false }),
    publish: () =>
      new Promise((resolve) => {
        finish = () => resolve({ agreement: false });
      }),
  };
  const { store } = setup(t, { workshop: () => workshop });
  await store.request({ kind: "import" });
  const upload = store.request({ kind: "publish", key: "local:test-grid" });
  while (!finish) await new Promise((resolve) => setImmediate(resolve));
  const listed = await store.request({ kind: "list" });
  assert.equal(listed.uploading, true);
  assert.equal(listed.entries.length, 1);
  finish();
  assert.equal((await upload).uploading, false);
});

test("templates are written by main with its own game version", async (t) => {
  const root = temporary(t);
  const target = path.join(root, "template.json");
  const store = new ModStore(root, { chooseSave: async () => target });
  const result = await store.request({ kind: "template", rules: "ignored" });
  assert.equal(
    result.message,
    "Template saved. Edit it, then choose Import mod.",
  );
  const pack = parseMod(fs.readFileSync(target, "utf8"));
  assert.equal(pack.gameApi, MOD_API_VERSION);
});

test("browsing opens the app's Workshop or a single item page", async (t) => {
  const opened = [];
  const { store } = setup(t, { openUrl: (url) => opened.push(url) });
  await store.request({ kind: "browse" });
  await store.request({ kind: "browse", workshopId: "456" });
  assert.match(
    (await store.request({ kind: "browse", workshopId: "../x" })).error,
    /Invalid Workshop item ID/,
  );
  assert.deepEqual(opened, [
    "https://steamcommunity.com/app/480/workshop/",
    "https://steamcommunity.com/sharedfiles/filedetails/?id=456",
  ]);
});

test("a corrupt library recovers its last completed transaction without deleting evidence", async (t) => {
  const store = new ModStore(temporary(t));
  await store.write({
    entries: [
      {
        key: "local:test-grid",
        source: "local",
        enabled: true,
        pack: fixture(),
      },
    ],
    published: {},
  });
  await store.write({ entries: [], published: {} });
  fs.writeFileSync(store.filename, "broken JSON");
  assert.equal((await entries(store))[0].pack.title, "Test Grid");
  assert.equal(fs.readFileSync(store.filename, "utf8"), "broken JSON");
  fs.writeFileSync(`${store.filename}.previous`, "also broken");
  const unreadable = await store.request({ kind: "list" });
  assert.equal(unreadable.unreadable, true);
  assert.match(unreadable.error, /Reset it to start over/);
  const reset = await store.request({ kind: "reset" });
  assert.equal(reset.unreadable, undefined);
  assert.deepEqual(reset.entries, []);
  const kept = fs
    .readdirSync(store.directory)
    .filter((name) => name.includes("unreadable"));
  assert.equal(kept.length, 2);
});

test("library entries are rebuilt from known fields and must be self-consistent", async (t) => {
  const store = new ModStore(temporary(t));
  const local = {
    key: "local:test-grid",
    source: "local",
    enabled: true,
    pack: fixture(),
  };
  for (const bad of [
    [{ ...local, key: "local:other" }],
    [{ ...local, source: "workshop", key: "workshop:1" }],
    [local, local],
  ]) {
    fs.mkdirSync(store.directory, { recursive: true });
    fs.writeFileSync(store.filename, JSON.stringify(bad));
    fs.rmSync(`${store.filename}.previous`, { force: true });
    assert.equal((await store.request({ kind: "list" })).unreadable, true);
  }
  fs.writeFileSync(
    store.filename,
    JSON.stringify([{ ...local, extra: "dropped" }]),
  );
  assert.deepEqual(Object.keys((await entries(store))[0]).sort(), [
    "enabled",
    "key",
    "pack",
    "source",
  ]);
});

test("launch cleans old upload stages and a cleanup failure never throws", async (t) => {
  const root = temporary(t);
  const stage = path.join(root, "mods", "upload-old123");
  fs.mkdirSync(stage, { recursive: true });
  fs.writeFileSync(path.join(stage, "scenario.json"), "{}");
  const store = new ModStore(root);
  assert.equal(fs.existsSync(stage), true, "constructing never touches disk");
  assert.equal(await store.cleanupStages(), true);
  assert.equal(fs.existsSync(stage), false);
  assert.equal(
    await new ModStore(path.join(root, "missing")).cleanupStages(),
    true,
  );
  // A file where the mods folder should be makes readdir fail.
  const blocked = temporary(t);
  fs.writeFileSync(path.join(blocked, "mods"), "not a folder");
  const warn = t.mock.method(console, "warn", () => {});
  assert.equal(await new ModStore(blocked).cleanupStages(), false);
  assert.equal(warn.mock.callCount(), 1);
});

test("unfinished uploads have a bounded disk footprint before any new Steam item is created", async (t) => {
  const { store } = setup(t, {
    workshop: () => ({ create: () => assert.fail("must not create") }),
  });
  await store.request({ kind: "import" });
  for (let i = 0; i < MAX_PACKAGES; i++)
    fs.mkdirSync(path.join(store.directory, `upload-${i}`));
  assert.match(
    (await store.request({ kind: "publish", key: "local:test-grid" })).error,
    /Restart Electrify/,
  );
});

test("packaged builds include every repository file the main process loads outside electron/", () => {
  const { files } = require("./electron-builder.config.cjs");
  for (const file of fs
    .readdirSync(__dirname)
    .filter((f) => f.endsWith(".cjs") && !f.endsWith(".test.cjs")))
    for (const [, target] of fs
      .readFileSync(path.join(__dirname, file), "utf8")
      .matchAll(/require\("\.\.\/(src\/[^"]+)"\)/g))
      assert.ok(files.includes(target), `${file} requires ${target}`);
});
