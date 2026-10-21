const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { CoopSaveStore } = require("./coop-storage.cjs");
const { stringify, parse } = require("./steam-multiplayer.cjs");

const self = "76561198000000001";
const world = (matchId = "one", changes = {}) => ({
  schema: 3,
  gameSchema: 3,
  rules: "rules-one",
  matchId,
  revision: 1,
  seats: [
    { id: self, name: "Host" },
    { id: "76561198000000002", name: "Friend" },
  ],
  grids: [{ cash: Infinity }],
  ...changes,
});
async function fixture(action) {
  const temporaryRoot = path.resolve(".tmp", "native-tests");
  fs.mkdirSync(temporaryRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(temporaryRoot, "coop-library-"));
  const cloud = new Map();
  const steam = {
    identity: { steamId: self },
    cloudState: () => "ready",
    writeCloudLibrary: (name, json, kind) => {
      assert.equal(kind, "coop");
      cloud.set(name, json);
      return true;
    },
    readCloudLibraries: (kind) => {
      assert.equal(kind, "coop");
      return [...cloud.values()];
    },
  };
  const store = new CoopSaveStore(directory, steam, { stringify, parse });
  try {
    await action({ directory, store, steam, cloud });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("independent named campaigns, selection, export/import and deletion preserve other matches", () =>
  fixture(async ({ directory, store }) => {
    await store.save(world());
    await store.save(world("two"));
    let library = await store.list();
    assert.equal(library.slots.length, 2);
    const one = library.slots.find((s) => s.matchId === "one").id;
    const two = library.slots.find((s) => s.matchId === "two").id;
    await store.rename(one, "Friends campaign");
    await store.select(two);
    const exported = path.join(directory, "portable.json");
    await store.exportFile(one, exported);
    assert.equal(
      store.activeId,
      two,
      "export never redirects the running campaign",
    );
    assert.equal(
      parse(fs.readFileSync(exported, "utf8")).grids[0].cash,
      Infinity,
    );
    await store.remove(one);
    assert.equal((await store.select(two)).matchId, "two");
    await store.importFile(exported);
    library = await store.list();
    assert.equal(library.slots.length, 2);
    assert(library.slots.some((s) => s.name === "Imported campaign"));
  }));

test("legacy checkpoint stays intact, upgrades keep immutable originals and future saves refuse overwrite", () =>
  fixture(async ({ directory, store }) => {
    const legacy = world("legacy", {
      schema: 2,
      gameSchema: undefined,
      rules: "old",
    });
    fs.writeFileSync(store.legacy, stringify(legacy));
    const selected = (await store.list()).slots[0];
    await store.select(selected.id);
    await store.save(world("legacy"));
    await store.save(world("legacy", { revision: 2 }));
    const backups = fs
      .readdirSync(directory)
      .filter((name) => name.startsWith("co-op-original-"));
    assert.equal(backups.length, 1);
    assert.equal(
      fs.readFileSync(path.join(directory, backups[0]), "utf8"),
      stringify(legacy),
    );
    assert.equal(fs.readFileSync(store.legacy, "utf8"), stringify(legacy));
    const imported = path.join(directory, "newer.json");
    fs.writeFileSync(imported, stringify(world("future", { schema: 99 })));
    await store.importFile(imported);
    const future = (await store.list()).slots.find(
      (s) => s.matchId === "future",
    );
    await store.select(future.id);
    const original = fs.readFileSync(store.filename, "utf8");
    await assert.rejects(store.save(world("future")), /newer game/);
    assert.equal(fs.readFileSync(store.filename, "utf8"), original);
  }));

test("device Cloud files retain divergent copies, deduplicate refreshes and honor deleted checkpoints", () =>
  fixture(async ({ directory, store, steam, cloud }) => {
    await store.save(world());
    const other = new CoopSaveStore(path.join(directory, "other"), steam, {
      stringify,
      parse,
    });
    await other.save(world("one", { revision: 2 }));
    assert.equal(cloud.size, 2);
    const library = await store.list(true);
    assert.equal(
      library.slots.length,
      2,
      "neither divergent checkpoint wins silently",
    );
    const copy = library.slots.find((s) => s.name.includes("Cloud copy"));
    await store.rename(copy.id, "Recovered game");
    await store.select(copy.id);
    await store.save(world("one", { revision: 3 }));
    assert.equal(
      (await store.list(true)).slots.length,
      2,
      "old remote checkpoint is already known",
    );
    await store.remove(copy.id);
    assert.equal((await store.list(true)).slots.length, 1);
  }));

test("corrupt current library recovers the complete prior write; corrupt or future libraries stay preserved", () =>
  fixture(async ({ store }) => {
    await store.save(world());
    await store.rename((await store.list()).slots[0].id, "Renamed");
    fs.writeFileSync(store.filename, "broken current");
    assert.equal((await store.list()).slots.length, 1);
    fs.writeFileSync(`${store.filename}.previous`, "broken backup");
    await assert.rejects(store.list(), /preserved/);
    fs.writeFileSync(
      store.filename,
      stringify({ schema: 99, slots: [], deleted: [] }),
    );
    await assert.rejects(store.save(world()), /newer game/);
    assert.equal(parse(fs.readFileSync(store.filename, "utf8")).schema, 99);
  }));

test("recovery writes preserve the verified backup when replacing the damaged current file fails", () =>
  fixture(async ({ store }) => {
    await store.save(world());
    await store.rename((await store.list()).slots[0].id, "Good");
    fs.writeFileSync(store.filename, "corrupt current library");
    assert.equal((await store.list()).slots.length, 1);
    const previous = fs.readFileSync(`${store.filename}.previous`, "utf8");
    const originalRename = fs.promises.rename;
    fs.promises.rename = async (from, to) => {
      if (to === store.filename)
        throw Object.assign(new Error("Injected rename denied"), {
          code: "EACCES",
        });
      return originalRename(from, to);
    };
    try {
      await assert.rejects(
        store.save(world("one", { revision: 2 })),
        /Injected rename denied/,
      );
    } finally {
      fs.promises.rename = originalRename;
    }
    assert.equal(
      fs.readFileSync(`${store.filename}.previous`, "utf8"),
      previous,
    );
    assert.equal((await store.list()).slots.length, 1);
    await store.save(world("one", { revision: 2 }));
    assert.equal(
      (await store.select((await store.list()).slots[0].id)).revision,
      2,
    );
  }));

test("invalid import, account mismatch and invalid names never replace campaigns", () =>
  fixture(async ({ store, directory }) => {
    await store.save(world());
    const id = (await store.list()).slots[0].id;
    assert.throws(() => store.rename(id, " "), /campaign name/);
    const filename = path.join(directory, "foreign.json");
    fs.writeFileSync(
      filename,
      stringify(
        world("foreign", { seats: [{ id: "other" }, { id: "stranger" }] }),
      ),
    );
    await assert.rejects(store.importFile(filename), /not one of its players/);
    assert.equal((await store.list()).slots.length, 1);
  }));

test("Cloud failures keep completed local writes and account libraries usable", () =>
  fixture(async ({ store, steam }) => {
    steam.writeCloudLibrary = () => false;
    await store.save(world());
    assert.equal((await store.list()).cloudState, "failed");
    steam.readCloudLibraries = () => {
      throw new Error("offline");
    };
    const result = await store.list(true);
    assert.equal(result.cloudState, "failed");
    assert.equal(result.slots.length, 1);
    assert.equal((await store.select(result.slots[0].id)).matchId, "one");
  }));

test("a full library can still list, export and delete while unseen Cloud campaigns wait", () =>
  fixture(async ({ directory, store, steam }) => {
    for (let i = 0; i < 32; i++) await store.save(world(`local-${i}`));
    const remote = new CoopSaveStore(path.join(directory, "remote"), steam, {
      stringify,
      parse,
    });
    await remote.save(world("remote"));
    const result = await store.list(true);
    assert.equal(result.slots.length, 32);
    assert.match(result.warning, /library is full/);
    const exported = path.join(directory, "full-library-export.json");
    await store.exportFile(result.slots[0].id, exported);
    assert(fs.existsSync(exported));
    await store.remove(result.slots[0].id);
    assert.equal((await store.list(true)).slots.length, 32);
  }));

test("a damaged legacy checkpoint cannot block a healthy library or new campaigns", () =>
  fixture(async ({ directory, store }) => {
    fs.writeFileSync(store.legacy, "damaged old checkpoint");
    assert.equal((await store.list()).slots.length, 0);
    await store.save(world());
    await store.save(world("two"));
    assert.equal((await store.list()).slots.length, 2);
    assert.equal(
      fs.readFileSync(store.legacy, "utf8"),
      "damaged old checkpoint",
    );
    const malformed = path.join(directory, "malformed-roster.json");
    fs.writeFileSync(
      malformed,
      stringify(
        world("bad", {
          seats: [
            { id: self, name: { unsafe: true } },
            { id: "76561198000000002", name: "Friend" },
          ],
        }),
      ),
    );
    await assert.rejects(
      store.importFile(malformed),
      /Invalid multiplayer save/,
    );
  }));
