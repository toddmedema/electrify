const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createTurnSignaling } = require("./coop-signaling.cjs");

// Model only the Firestore operations used by the service, with the provider and
// clock injected. Grant identity, issuance, pair validation and cleanup run normally.
function fixture() {
  let now = 1_000;
  const values = new Map();
  const doc = (path) => ({
    path,
    get: async () => ({
      exists: values.has(path),
      data: () => values.get(path),
      ref: doc(path),
    }),
    update: async (fields) => {
      assert.ok(values.has(path));
      values.set(path, { ...values.get(path), ...fields });
    },
  });
  const getAll = (...refs) => Promise.all(refs.map((ref) => ref.get()));
  function query(matches) {
    const keys = [...values]
      .filter(
        ([path, value]) => path.startsWith("coopTurnGrants/") && matches(value),
      )
      .map(([path]) => doc(path));
    return { get: async () => ({ docs: await getAll(...keys) }) };
  }
  const db = {
    doc,
    getAll,
    collection: (name) => ({
      doc: (id) => doc(name + "/" + id),
      limit: () => query(() => true),
      where: (key, op, expected) => {
        assert.equal(op, "==");
        return query((data) => data[key] === expected);
      },
    }),
    runTransaction: (apply) =>
      apply({
        getAll,
        get: (target) => target.get(),
        create: (ref, data) => {
          assert.ok(!values.has(ref.path));
          values.set(ref.path, data);
        },
        set: (ref, data) =>
          values.set(ref.path, { ...values.get(ref.path), ...data }),
        delete: (ref) => values.delete(ref.path),
      }),
  };
  const room = {
    epoch: "epoch",
    hostId: "host",
    members: ["host", "guest-a", "guest-b"].map((id) => ({
      id,
      active: true,
      binding: id,
    })),
    leaseUntil: Number.MAX_SAFE_INTEGER,
  };
  let revocationStatus = 204;
  const requests = [];
  const signaling = createTurnSignaling({
    db,
    keyId: "key",
    keyToken: "test-token",
    loadRoom: async () => room,
    clock: () => now,
    fetchImpl: async (url) => {
      const operation = url.split("/").at(-1);
      requests.push(operation);
      if (operation === "revoke") return { status: revocationStatus };
      assert.equal(operation, "generate-ice-servers");
      return {
        status: 201,
        json: async () => ({
          iceServers: [
            {
              username: "user-" + requests.length,
              credential: "temporary",
              urls: [
                "turn:turn.cloudflare.com:3478?transport=udp",
                "turns:turn.cloudflare.com:443?transport=tcp",
              ],
            },
          ],
        }),
      };
    },
  });
  const context = {
    roomId: "room",
    seatId: "host",
    async updateRoom(apply) {
      const result = apply(room, now, room);
      if (result.room) Object.assign(room, result.room);
      return result.value;
    },
  };
  const read = () => signaling.handle("signal/read", context, {});
  const issue = (to, actor = context) =>
    signaling.handle("signal/turn", actor, {
      to,
      generation: room.signals[to].generation,
    });
  return {
    context,
    issue,
    read,
    room,
    requests,
    reap: signaling.reap,
    values,
    advance: (ms) => {
      now += ms;
    },
    refuseRevocation: () => {
      revocationStatus = 503;
    },
  };
}

test("confirmation replaces only the obsolete pair and defers provider calls until cleanup", async () => {
  const f = fixture();
  await f.read();
  await f.issue("guest-a");
  const before = { ...f.room.signals };
  f.room.members[1].binding = "new-device";
  const { pairs } = await f.read();
  assert.notEqual(
    pairs.find((p) => p.peerId === "guest-a").generation,
    before["guest-a"].generation,
  );
  assert.equal(
    pairs.find((p) => p.peerId === "guest-b").generation,
    before["guest-b"].generation,
  );
  assert.deepEqual(f.requests, ["generate-ice-servers"]);
  await f.reap();
  assert.deepEqual(f.requests, ["generate-ice-servers", "revoke"]);
});

test("an occupied pair budget leaves grants available for a different pair", async () => {
  const f = fixture();
  await f.read();
  for (let i = 0; i < 20; i++) {
    f.values.set("coopTurnGrants/draining-" + i, {
      roomId: "room",
      seatId: i % 2 ? "host" : "guest-a",
      to: i % 2 ? "guest-a" : "host",
    });
  }
  f.values.set("coopOperations/turn", { count: 20 });
  await assert.rejects(f.issue("guest-a"), { code: "turn-capacity" });
  assert.equal((await f.issue("guest-b")).iceServers.length, 1);
  assert.deepEqual(f.requests, ["generate-ice-servers"]);
  assert.equal(f.values.get("coopOperations/turn").count, 21);
});

test("reservations from previous rosters leave capacity for the other live room", async () => {
  const f = fixture();
  await f.read();
  for (let i = 0; i < 60; i++)
    f.values.set("coopTurnGrants/old-seat-" + i, {
      roomId: "crowded",
      seatId: "host",
      to: "former-" + i,
    });
  f.values.set("coopOperations/turn", { count: 60 });
  await assert.rejects(
    f.issue("guest-a", { ...f.context, roomId: "crowded" }),
    { code: "turn-capacity" },
  );
  assert.equal((await f.issue("guest-a")).iceServers.length, 1);
  assert.deepEqual(f.requests, ["generate-ice-servers"]);
  assert.equal(f.values.get("coopOperations/turn").count, 61);
});

test("an existing grant survives transient final room validation", async () => {
  const f = fixture();
  await f.read();
  const live = await f.issue("guest-a");
  let reads = 0;
  const transient = new Error("Firestore read unavailable");
  const actor = {
    ...f.context,
    updateRoom: (...args) => {
      if (++reads === 2) throw transient;
      return f.context.updateRoom(...args);
    },
  };
  await assert.rejects(f.issue("guest-a", actor), transient);
  assert.deepEqual(await f.issue("guest-a"), live);
  assert.deepEqual(f.requests, ["generate-ice-servers"]);
});

test("provider refusal remains retryable until the drain deadline releases the record", async () => {
  const f = fixture();
  await f.read();
  await f.issue("guest-a");
  f.room.members[1].active = false;
  f.refuseRevocation();
  await assert.rejects(f.reap(), /needs retry/);
  assert.equal(f.values.get("coopOperations/turn").count, 1);
  f.advance(720_000);
  await f.reap();
  assert.deepEqual(f.requests, ["generate-ice-servers", "revoke"]);
  assert.equal(f.values.get("coopOperations/turn").count, 0);
  assert.ok(
    ![...f.values.keys()].some((key) => key.startsWith("coopTurnGrants/")),
  );
});
