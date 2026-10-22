const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ModStore, readPackage, MAX_PACKAGES } = require("./mods.cjs");
const {
  parseMod,
  packageDigest,
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
  description: "A community scenario for the test grid.",
  objectives: { mode: "inherit" },
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
    // Prototype fields are replaced in place, without a legacy adapter.
    { scenario: { eventScenarioIds: [100] } },
    {
      notifications: [
        { month: 1, title: "Review", message: "Review the grid." },
      ],
    },
    {
      officialArcs: [
        { scenarioId: 100, includeChoices: true },
        { scenarioId: 100, includeChoices: true },
      ],
    },
    {
      events: [{ id: "opening", startMonth: 0, title: "bad", message: "bad" }],
    },
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
    /^facilities\.Solr is not a supported field\. Use one of: Coal, .*Solar/,
  );
  assert.equal(
    message({ scenario: { startingYear: 1700 } }),
    "scenario.startingYear must be a whole number from 1980 to 2100.",
  );
  assert.match(message("{ not json"), /^scenario\.json is not valid JSON \(/);
  assert.equal(
    message({ events: [{ id: "opening", startMonth: 2, title: "t" }] }),
    "events[0].message must be non-empty text.",
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
  const collision = await store.request({ kind: "import" });
  assert.equal(collision.importConflict.incoming.version, "2");
  assert.equal(collision.entries[0].pack.version, "1");
  assert.equal(
    (
      await store.request({
        kind: "resolveImport",
        token: collision.importConflict.token,
        action: "update",
      })
    ).message,
    "Updated Test Grid.",
  );
  const restored = await entries(new ModStore(root));
  assert.equal(restored[0].enabled, false);
  assert.equal(restored[0].pack.version, "2");
  await store.request({ kind: "remove", key: "local:test-grid" });
  assert.deepEqual(await entries(store), []);
  assert.equal(snapshot.version, "1");
});

test("one damaged entry is quarantined without rolling healthy siblings or publication mappings back", async (t) => {
  const { store } = setup(t);
  const healthy = {
    key: "local:test-grid",
    source: "local",
    enabled: false,
    pack: fixture({ version: "2" }),
  };
  await store.write({
    entries: [healthy],
    published: { "test-grid": { workshopId: "456", uploaded: true } },
  });
  const original = {
    ...healthy,
    key: "local:bad-grid",
    pack: fixture({
      id: "bad-grid",
      title: "Unsafe\u202etitle",
      facilities: { Solar: { buildCost: 1e308 } },
    }),
  };
  fs.writeFileSync(
    store.filename,
    JSON.stringify({
      entries: [healthy, original],
      published: { "test-grid": { workshopId: "456", uploaded: true } },
    }),
  );
  const result = await store.request({ kind: "list" });
  assert.equal(result.unreadable, undefined);
  assert.equal(result.entries[0].pack.version, "2");
  assert.equal(result.entries[0].workshopId, "456");
  assert.equal(result.quarantined.length, 1);
  assert.doesNotMatch(result.quarantined[0].title, /\u202e/);
  assert.deepEqual(JSON.parse(result.quarantined[0].original), original);
  assert.match(result.quarantined[0].diagnostic, /buildCost/);
  await store.request({ kind: "enable", key: healthy.key, enabled: true });
  assert.equal((await store.request({ kind: "list" })).quarantined.length, 1);
  const discarded = await store.request({
    kind: "discard",
    key: result.quarantined[0].key,
  });
  assert.deepEqual(discarded.quarantined, []);
  assert.equal(discarded.entries[0].workshopId, "456");
});

test("a collision is reviewed before Update or Install as copy, and copies never inherit publication identity", async (t) => {
  const { file, store } = setup(t);
  await store.request({ kind: "import" });
  const library = await store.read();
  library.published["test-grid"] = { workshopId: "456", uploaded: true };
  library.entries[0].enabled = false;
  await store.write(library);
  fs.writeFileSync(
    file,
    JSON.stringify(
      fixture({
        title: "Different Grid",
        creator: "Different Creator",
        version: "9",
      }),
    ),
  );
  const preview = await store.request({ kind: "import" });
  assert.equal(preview.importConflict.existing.title, "Test Grid");
  assert.equal(preview.importConflict.incoming.creator, "Different Creator");
  assert.equal(preview.entries[0].pack.title, "Test Grid");
  const copy = await store.request({
    kind: "resolveImport",
    token: preview.importConflict.token,
    action: "copy",
  });
  assert.equal(copy.entries.length, 2);
  const added = copy.entries.find((e) => e.pack.title === "Different Grid");
  assert.notEqual(added.pack.id, "test-grid");
  assert.equal(added.workshopId, undefined);
  assert.equal(copy.entries[0].enabled, false);
  const again = await store.request({ kind: "import" });
  const update = await store.request({
    kind: "resolveImport",
    token: again.importConflict.token,
    action: "update",
  });
  assert.equal(
    update.entries.find((e) => e.pack.id === "test-grid").workshopId,
    "456",
  );
  assert.equal(
    update.entries.find((e) => e.pack.id === "test-grid").enabled,
    false,
  );
  assert.match(
    (
      await store.request({
        kind: "resolveImport",
        token: again.importConflict.token,
        action: "update",
      })
    ).error,
    /expired/,
  );
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
  const before = fs.statSync(store.filename).mtimeMs;
  const previous = fs.existsSync(`${store.filename}.previous`)
    ? fs.readFileSync(`${store.filename}.previous`, "utf8")
    : null;
  assert.equal(
    (await store.request({ kind: "refresh" })).message,
    "Workshop mods are up to date.",
  );
  assert.equal(fs.statSync(store.filename).mtimeMs, before);
  assert.equal(
    fs.existsSync(`${store.filename}.previous`)
      ? fs.readFileSync(`${store.filename}.previous`, "utf8")
      : null,
    previous,
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

test("refresh returns queued, downloading and skipped identities separately", async (t) => {
  const { store } = setup(t, {
    workshop: () => ({
      subscribed: () => ["111", "222", "333"],
      installedOrQueueDownload: (id) => {
        if (id === "333") throw new Error("Download is truncated.");
        return null;
      },
      downloadStatus: (id) => (id === "111" ? "queued" : "downloading"),
    }),
  });
  const result = await store.request({ kind: "refresh" });
  assert.deepEqual(
    result.downloads.map(({ id, status }) => ({ id, status })),
    [
      { id: "111", status: "queued" },
      { id: "222", status: "downloading" },
      { id: "333", status: "skipped" },
    ],
  );
  assert.match(result.downloads[2].message, /truncated/);
});

test("writing a recovered library preserves its last-good backup even if replacement fails", async (t) => {
  const { store } = setup(t);
  await store.request({ kind: "import" });
  const library = await store.read();
  library.published["test-grid"] = { workshopId: "456", uploaded: true };
  await store.write(library);
  // A completed neighbor makes the previous file the fully published library.
  await store.request({
    kind: "enable",
    key: "local:test-grid",
    enabled: false,
  });
  const backup = fs.readFileSync(`${store.filename}.previous`, "utf8");
  fs.writeFileSync(store.filename, "broken JSON");
  const rename = t.mock.method(fs.promises, "rename", async () => {
    throw new Error("disk unavailable");
  });
  const failed = await store.request({
    kind: "enable",
    key: "local:test-grid",
    enabled: false,
  });
  assert.match(failed.error, /disk unavailable/);
  assert.equal(failed.entries[0].workshopId, "456");
  assert.equal(fs.readFileSync(`${store.filename}.previous`, "utf8"), backup);
  rename.mock.restore();
  const success = await store.request({
    kind: "enable",
    key: "local:test-grid",
    enabled: false,
  });
  assert.equal(success.entries[0].enabled, false);
  assert.equal(success.entries[0].workshopId, "456");
  assert.equal(fs.readFileSync(`${store.filename}.previous`, "utf8"), backup);
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
    rulesDescription:
      fixture().description +
      "\n\nRules\nBase: Custom game\nDuration:240months",
    key: "local:test-grid",
    packageDigest: packageDigest(fixture()),
  });
  assert.equal(failed.error, "upload failed");
  // The UI sees the created item immediately, even though the upload failed.
  assert.equal(failed.entries[0].workshopId, "456");
  const result = await store.request({
    kind: "publish",
    rulesDescription:
      fixture().description +
      "\n\nRules\nBase: Custom game\nDuration:240months",
    key: "local:test-grid",
    packageDigest: packageDigest(fixture()),
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
    rulesDescription:
      fixture().description +
      "\n\nRules\nBase: Custom game\nDuration:240months",
    key: "local:test-grid",
    packageDigest: packageDigest(fixture()),
  });
  assert.equal(update.message, "Published to Steam Workshop.");
  assert.equal(creates, 1);
  // Visibility is set while the new item has never uploaded, never on later updates.
  assert.deepEqual(
    uploads.map((u) => u.setVisibility),
    [true, true, false],
  );
  assert.deepEqual(
    uploads.map((u) => u.description),
    Array(3).fill(
      fixture().description +
        "\n\nRules\nBase: Custom game\nDuration:240months",
    ),
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
  const rejected = await store.request({ kind: "import" });
  assert.match(rejected.error, /gameApi must be 1/);
  assert.equal(rejected.entries.length, 0);
  assert.ok(
    rejected.diagnostics.some(
      (d) => d.code === "game-api" && d.path === "gameApi",
    ),
  );
  assert.match(
    (
      await store.request({
        kind: "publish",
        rulesDescription:
          fixture().description +
          "\n\nRules\nBase: Custom game\nDuration:240months",
        key: "local:test-grid",
        packageDigest: packageDigest(fixture()),
      })
    ).error,
    /no longer installed/,
  );
});

test("publishing requires the exact package digest validated by the renderer before creating or staging an upload", async (t) => {
  let creates = 0;
  let uploads = 0;
  const { store } = setup(t, {
    workshop: () => ({
      create: async () => {
        creates++;
        return { id: "456", agreement: false };
      },
      publish: async () => {
        uploads++;
        return { id: "456", agreement: false };
      },
    }),
  });
  await store.request({ kind: "import" });
  const checkedDigest = packageDigest(fixture());
  const stale = await store.read();
  stale.entries[0].pack.version = "2";
  await store.write(stale);
  for (const requested of [
    undefined,
    "sha256-" + "0".repeat(64),
    checkedDigest,
  ]) {
    const result = await store.request({
      kind: "publish",
      rulesDescription:
        fixture().description +
        "\n\nRules\nBase: Custom game\nDuration:240months",
      key: "local:test-grid",
      packageDigest: requested,
    });
    assert.match(result.error, /digest|changed|validat/i);
    assert.equal(creates, 0);
    assert.equal(uploads, 0);
    assert.deepEqual(
      fs
        .readdirSync(store.directory)
        .filter((name) => name.startsWith("upload-")),
      [],
    );
  }
  const accepted = await store.request({
    kind: "publish",
    rulesDescription:
      fixture().description +
      "\n\nRules\nBase: Custom game\nDuration:240months",
    key: "local:test-grid",
    packageDigest: packageDigest(fixture({ version: "2" })),
  });
  assert.equal(accepted.error, undefined);
  assert.equal(creates, 1);
  assert.equal(uploads, 1);
});

test("publishing rejects missing, stale, unsafe or oversized generated Rules before creating an item", async (t) => {
  let creates = 0;
  let uploads = 0;
  const { store } = setup(t, {
    workshop: () => ({
      create: async () => {
        creates++;
        return { id: "456", agreement: false };
      },
      publish: async (_id, _pack, _stage, options) => {
        uploads++;
        return { id: "456", agreement: false };
      },
    }),
  });
  await store.request({ kind: "import" });
  const prefix = fixture().description + "\n\nRules\n";
  for (const rulesDescription of [
    undefined,
    "An old authored claim.\n\nRules\nDuration: 6 months",
    prefix + "<script>unsafe</script>",
    prefix + "é".repeat(4000),
  ]) {
    const result = await store.request({
      kind: "publish",
      key: "local:test-grid",
      packageDigest: packageDigest(fixture()),
      rulesDescription,
    });
    assert.ok(result.error);
    assert.equal(creates, 0);
    assert.equal(uploads, 0);
    assert.deepEqual(
      fs
        .readdirSync(store.directory)
        .filter((name) => name.startsWith("upload-")),
      [],
    );
  }
  const result = await store.request({
    kind: "publish",
    key: "local:test-grid",
    packageDigest: packageDigest(fixture()),
    rulesDescription: prefix + "x".repeat(7999 - Buffer.byteLength(prefix)),
  });
  assert.equal(result.error, undefined);
  assert.equal(creates, 1);
  assert.equal(uploads, 1);
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
  const upload = store.request({
    kind: "publish",
    rulesDescription:
      fixture().description +
      "\n\nRules\nBase: Custom game\nDuration:240months",
    key: "local:test-grid",
    packageDigest: packageDigest(fixture()),
  });
  while (!finish) await new Promise((resolve) => setImmediate(resolve));
  let browsed = false;
  store.openUrl = () => {
    browsed = true;
  };
  await store.request({ kind: "browse" });
  assert.equal(browsed, true);
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
  assert.equal(pack.$schema, "./scenario.schema.json");
  const schema = JSON.parse(
    fs.readFileSync(path.join(root, "scenario.schema.json"), "utf8"),
  );
  assert.deepEqual(
    schema,
    require("../src/mods/ModEditorSchema").createModEditorSchema(),
  );
  const withoutSchema = { ...pack };
  delete withoutSchema.$schema;
  assert.equal(packageDigest(pack), packageDigest(withoutSchema));
});

test("offline template cancellation and schema-name collisions write no partial pair", async (t) => {
  const root = temporary(t);
  const store = new ModStore(root, { chooseSave: async () => undefined });
  const cancelled = await store.request({ kind: "template" });
  assert.equal(cancelled.error, undefined);
  assert.equal(cancelled.message, undefined);
  assert.deepEqual(cancelled.entries, []);
  assert.deepEqual(fs.readdirSync(root), []);
  store.chooseSave = async () => path.join(root, "scenario.schema.json");
  assert.match((await store.request({ kind: "template" })).error, /reserved/);
  assert.deepEqual(fs.readdirSync(root), []);
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
  const recovered = await store.request({ kind: "list" });
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.entries[0].pack.title, "Test Grid");
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
    const result = await store.request({ kind: "list" });
    assert.equal(result.unreadable, undefined);
    assert.equal(result.quarantined.length, 1);
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
    (
      await store.request({
        kind: "publish",
        rulesDescription:
          fixture().description +
          "\n\nRules\nBase: Custom game\nDuration:240months",
        key: "local:test-grid",
        packageDigest: packageDigest(fixture()),
      })
    ).error,
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

test("malformed quarantine siblings and oversized entries retain bounded originals without rolling back healthy mods", async (t) => {
  const { store } = setup(t);
  const healthy = {
    key: "local:test-grid",
    source: "local",
    enabled: true,
    pack: fixture({ version: "newest" }),
  };
  fs.mkdirSync(store.directory, { recursive: true });
  fs.writeFileSync(
    store.filename,
    JSON.stringify({
      entries: [
        healthy,
        { pack: fixture({ unknown: "x".repeat(MAX_MOD_BYTES) }) },
      ],
      quarantined: [null],
      published: {},
    }),
  );
  const result = await store.request({ kind: "list" });
  assert.equal(result.unreadable, undefined);
  assert.equal(result.entries[0].pack.version, "newest");
  assert.equal(result.quarantined.length, 2);
  assert.equal(result.quarantined[0].originalTruncated, true);
  for (const entry of result.quarantined)
    assert.ok(Buffer.byteLength(entry.original) <= MAX_MOD_BYTES);
  assert.equal(result.quarantined[1].original, "null");
});

test("Workshop-agreement actions survive reopening and can be explicitly dismissed", async (t) => {
  const { root, store } = setup(t, {
    workshop: () => ({
      create: async () => ({ id: "456", agreement: true }),
      publish: async () => ({ agreement: true }),
    }),
  });
  await store.request({ kind: "import" });
  await store.request({
    kind: "publish",
    rulesDescription:
      fixture().description +
      "\n\nRules\nBase: Custom game\nDuration:240months",
    key: "local:test-grid",
    packageDigest: packageDigest(fixture()),
  });
  const reopened = new ModStore(root);
  assert.deepEqual((await reopened.request({ kind: "list" })).agreements, [
    "456",
  ]);
  await reopened.request({ kind: "dismissAgreement", workshopId: "456" });
  assert.deepEqual((await reopened.request({ kind: "list" })).agreements, []);
});
