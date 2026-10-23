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

test("independent campaigns, selection and deletion preserve other matches", () =>
  fixture(async ({ store }) => {
    await store.save(world());
    await store.save(world("two"));
    const library = await store.list();
    assert.equal(library.slots.length, 2);
    const one = library.slots.find((s) => s.matchId === "one").id;
    const two = library.slots.find((s) => s.matchId === "two").id;
    assert.equal((await store.select(one)).grids[0].cash, Infinity);
    await store.select(two);
    await store.remove(one);
    assert.equal((await store.list()).slots.length, 1);
    assert.equal((await store.select(two)).matchId, "two");
  }));

test("unsupported world schemas are rejected before changing the save library", () =>
  fixture(async ({ store }) => {
    await store.save(world());
    const original = fs.readFileSync(store.filename, "utf8");
    for (const schema of [2, 99]) {
      await assert.rejects(
        store.save(world("one", { schema })),
        /Invalid multiplayer save/,
      );
      assert.equal(fs.readFileSync(store.filename, "utf8"), original);
    }
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
    await store.save(world("one", { revision: 2 }));
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
    await store.save(world("one", { revision: 2 }));
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

test("invalid accounts and malformed player names never replace campaigns", () =>
  fixture(async ({ store }) => {
    await store.save(world());
    for (const seats of [
      [{ id: "other" }, { id: "stranger" }],
      [
        { id: self, name: { unsafe: true } },
        { id: "76561198000000002", name: "Friend" },
      ],
    ]) {
      await assert.rejects(
        store.save(world("bad", { seats })),
        /Invalid multiplayer save/,
      );
      assert.equal((await store.list()).slots.length, 1);
    }
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

test("a full library can still list and delete while unseen Cloud campaigns wait", () =>
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
    await store.remove(result.slots[0].id);
    assert.equal((await store.list(true)).slots.length, 32);
  }));
