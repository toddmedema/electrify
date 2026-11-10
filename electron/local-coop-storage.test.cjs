const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { LocalCoopSaveStore } = require("./local-coop-storage.cjs");
const { CoopSaveStore } = require("./coop-storage.cjs");
const codec = require("./coop-codec.cjs");

const owner = "76561198000000001";
const world = (count = 2, changes = {}) => {
  const seats = Array.from({ length: count }, (_, i) => ({
    id: `local-p${i + 1}`,
    name: `Company ${i + 1}`,
  }));
  return {
    schema: 3,
    gameSchema: 3,
    rules: "rules-one",
    spec: { scenarioId: 1, difficulty: "normal" },
    matchId: "one",
    epoch: "epoch-one",
    revision: 1,
    seats,
    grids: seats.map((seat) => ({
      cash: Infinity,
      multiplayer: { seat: seat.id },
      timeline: [{ cash: 123 }],
    })),
    edges: seats.flatMap((a, i) =>
      seats.slice(i + 1).map((b) => ({ a: a.id, b: b.id, capacityW: 20 })),
    ),
    outcomes: { [seats[0].id]: { outcome: "bankrupt", month: 1 } },
    selectedSpeeds: Object.fromEntries(
      seats.map((seat) => [seat.id, "NORMAL"]),
    ),
    activities: {},
    sequences: Object.fromEntries(seats.map((seat) => [seat.id, 3])),
    receipts: Object.fromEntries(
      seats.map((seat) => [seat.id, { sequence: 3 }]),
    ),
    ...changes,
  };
};

async function fixture(action, ownerId = owner) {
  const temporaryRoot = path.resolve(".tmp", "native-tests");
  fs.mkdirSync(temporaryRoot, { recursive: true });
  const directory = fs.mkdtempSync(
    path.join(temporaryRoot, "local-coop-library-"),
  );
  const store = new LocalCoopSaveStore(directory, ownerId, codec);
  try {
    await action({ directory, store });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

for (const count of [2, 3, 4]) {
  test(`${count} local companies preserve all grids, edges, outcomes and receipts atomically`, () =>
    fixture(async ({ store, directory }) => {
      const checkpoint = world(count);
      const saved = await store.save(checkpoint);
      const reopened = new LocalCoopSaveStore(directory, owner, codec);
      assert.deepEqual(await reopened.select(saved.id), checkpoint);
      const library = await reopened.list();
      assert.equal(library.storage, "local");
      assert.equal(library.kind, "local");
      assert.equal(library.slots[0].updatedAt, saved.updatedAt);
      assert.deepEqual(
        library.slots[0].players,
        checkpoint.seats.map((seat) => seat.name),
      );
      assert.equal(
        fs.existsSync(path.join(directory, "co-op-library.json")),
        false,
      );
      await reopened.remove(saved.id);
      assert.equal((await reopened.list()).slots.length, 0);
    }));
}

test("offline account saves need no Steam service and account ownership cannot be forged", () =>
  fixture(async ({ store, directory }) => {
    const saved = await store.save(world());
    assert.ok(await store.select(saved.id));
    const otherAccount = new LocalCoopSaveStore(directory, owner, codec);
    await assert.rejects(otherAccount.list(), /preserved/);
    assert.throws(
      () => new LocalCoopSaveStore(directory, "../outside", codec),
      /owner/,
    );
  }, "offline"));

test("online and local membership boundaries reject each other's seats", () =>
  fixture(async ({ directory, store }) => {
    const online = new CoopSaveStore(
      directory,
      {
        identity: { steamId: owner },
      },
      codec,
    );
    await assert.rejects(online.save(world()), /Invalid multiplayer save/);
    const checkpoint = world();
    checkpoint.seats[0].id = owner;
    checkpoint.grids[0].multiplayer.seat = owner;
    await assert.rejects(store.save(checkpoint), /logical company roster/);
    assert.equal((await store.list()).slots.length, 0);
  }));

test("incomplete worlds and persisted controller bindings never replace a checkpoint", () =>
  fixture(async ({ store }) => {
    await store.save(world());
    const original = fs.readFileSync(store.filename, "utf8");
    for (const checkpoint of [
      world(2, { grids: [] }),
      world(2, { edges: [] }),
      world(2, { receipts: null }),
      world(2, { outcomes: { outsider: { outcome: "bankrupt" } } }),
      world(2, {
        seats: [
          { id: "local-p1", name: "A", controllerHandle: "123" },
          { id: "local-p2", name: "B" },
        ],
      }),
      world(2, {
        seats: [
          { id: "local-p2", name: "B" },
          { id: "local-p1", name: "A" },
        ],
      }),
      world(2, { schema: 99 }),
      world(2, { controllerBindings: { "local-p1": "101" } }),
    ]) {
      await assert.rejects(
        store.save(checkpoint),
        /Invalid local couch checkpoint/,
      );
      assert.equal(fs.readFileSync(store.filename, "utf8"), original);
    }
  }));

test("queued writes capture input and settle in order, rejecting stale revisions", () =>
  fixture(async ({ store }) => {
    const first = world();
    const one = store.save(first);
    first.revision = 99;
    first.grids[0].timeline[0].cash = -1;
    const two = store.save(world(2, { revision: 2 }));
    await Promise.all([one, two, store.drain()]);
    const [slot] = (await store.list()).slots;
    const checkpoint = await store.select(slot.id);
    assert.equal(checkpoint.revision, 2);
    assert.equal(checkpoint.grids[0].timeline[0].cash, 123);
    await assert.rejects(store.save(world()), /newer local couch checkpoint/);
    assert.equal((await store.select(slot.id)).revision, 2);
  }));

test("write failure preserves the previous complete copy and can retry", () =>
  fixture(async ({ store }) => {
    const initial = await store.save(world());
    const originalRename = fs.promises.rename;
    fs.promises.rename = async (from, to) => {
      if (to === store.filename) throw new Error("Injected disk write failure");
      return originalRename(from, to);
    };
    try {
      await assert.rejects(
        store.save(world(2, { revision: 2 })),
        /disk write failure/,
      );
    } finally {
      fs.promises.rename = originalRename;
    }
    assert.equal((await store.select(initial.id)).revision, 1);
    const retry = await store.save(world(2, { revision: 2 }));
    assert.equal((await store.select(retry.id)).revision, 2);
    assert.equal(
      fs
        .readdirSync(path.dirname(store.filename))
        .some((file) => file.endsWith(".tmp")),
      false,
    );
  }));

test("corrupt current files recover the complete backup without destroying unreadable evidence", () =>
  fixture(async ({ store, directory }) => {
    const initial = await store.save(world());
    await store.save(world(2, { revision: 2 }));
    fs.writeFileSync(store.filename, "interrupted file");
    assert.equal((await store.select(initial.id)).revision, 1);
    await store.save(world(2, { revision: 3 }));
    const evidence = fs
      .readdirSync(directory)
      .find((file) => file.includes(".unreadable-"));
    assert.equal(
      fs.readFileSync(path.join(directory, evidence), "utf8"),
      "interrupted file",
    );
    assert.equal((await store.select(initial.id)).revision, 3);
  }));

test("future and unreadable libraries stay preserved; full libraries can still update and remove", () =>
  fixture(async ({ store }) => {
    for (let i = 0; i < 32; i++)
      await store.save(world(2, { matchId: `match-${i}` }));
    await assert.rejects(
      store.save(world(2, { matchId: "overflow" })),
      /library is full/,
    );
    const slots = (await store.list()).slots;
    await store.save(world(2, { matchId: slots[0].matchId, revision: 2 }));
    await store.remove(slots[0].id);
    assert.equal((await store.list()).slots.length, 31);
    const future = codec.stringify({
      schema: 99,
      kind: "local",
      ownerId: owner,
      slots: [],
    });
    fs.writeFileSync(store.filename, future);
    await assert.rejects(store.save(world()), /newer game/);
    assert.equal(fs.readFileSync(store.filename, "utf8"), future);
    fs.writeFileSync(store.filename, "unreadable current");
    fs.writeFileSync(`${store.filename}.previous`, "unreadable backup");
    await assert.rejects(store.save(world()), /preserved/);
    assert.equal(fs.readFileSync(store.filename, "utf8"), "unreadable current");
  }));
