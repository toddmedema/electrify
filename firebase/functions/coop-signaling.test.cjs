const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  activeSignalPair,
  createTurnSignaling,
} = require("./coop-signaling.cjs");

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
  const revoked = [];
  const signaling = createTurnSignaling({
    db,
    keyId: "key",
    keyToken: "test-token",
    loadRoom: async () => room,
    clock: () => now,
    fetchImpl: async (url) => {
      const parts = String(url).split("/");
      const operation = parts.at(-1);
      requests.push(operation);
      if (operation === "revoke") {
        revoked.push(decodeURIComponent(parts.at(-2)));
        return { status: revocationStatus };
      }
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
  const read = (actor = context) => signaling.handle("signal/read", actor, {});
  const issue = (
    to,
    actor = context,
    generation = room.signals[to].generation,
  ) => signaling.handle("signal/turn", actor, { to, generation });
  return {
    context,
    handle: signaling.handle,
    issue,
    read,
    room,
    requests,
    revoked,
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

function description(type) {
  const address = type === "offer" ? "8.8.8.8" : "9.9.9.9";
  return {
    type,
    sdp: [
      "v=0",
      "o=- 4321 2 IN IP4 0.0.0.0",
      "s=-",
      "t=0 0",
      "m=application 12212 UDP/DTLS/SCTP webrtc-datachannel",
      `c=IN IP4 ${address}`,
      `a=candidate:455721 1 udp 30298521 ${address} 12212 typ relay`,
      "a=ice-ufrag:iA22",
      "a=ice-pwd:FtboouybttTfOsvwT8PvWx",
      `a=fingerprint:sha-256 ${Array(32).fill("C2").join(":")}`,
      `a=setup:${type === "offer" ? "actpass" : "active"}`,
      "a=mid:0",
      "a=sctp-port:5000",
      "",
    ].join("\r\n"),
  };
}

async function negotiated(f) {
  await f.read();
  const guest = { ...f.context, seatId: "guest-a" };
  const { generation } = f.room.signals["guest-a"];
  await f.handle("signal/describe", f.context, {
    to: "guest-a",
    generation,
    description: description("offer"),
  });
  await f.handle("signal/describe", guest, {
    to: "host",
    generation,
    description: description("answer"),
  });
  return { guest, generation, address: { to: "guest-a", generation } };
}

test("preparing a successor preserves both grants until the old generation expires", async () => {
  const f = fixture();
  const { guest, generation, address } = await negotiated(f);
  const stillEarly = f.handle("signal/prepare", f.context, address);
  await assert.rejects(stillEarly, { code: "turn-rotation-limit" });
  const predecessor = await f.issue("guest-a");
  f.advance(85_000);
  await f.handle("signal/prepare", f.context, address);
  const next = f.room.signals["guest-a"].successor.generation;
  await f.handle("signal/prepare", guest, { to: "host", generation });
  const successor = await f.issue("guest-a", f.context, next);
  const { pairs } = await f.read(guest);
  assert.equal(pairs[0].generation, generation);
  assert.equal(pairs[0].successor.generation, next);
  assert.ok(activeSignalPair(f.room, "guest-a", "host", next, 86_000));
  assert.ok(activeSignalPair(f.room, "guest-a", "host", generation, 86_000));
  await f.reap();
  assert.deepEqual(f.requests, [
    "generate-ice-servers",
    "generate-ice-servers",
  ]);

  f.advance(35_000);
  assert.equal((await f.read(guest)).pairs[0].generation, next);
  await assert.rejects(f.issue("guest-a", f.context, generation), {
    code: "obsolete-connection",
  });
  await f.reap();
  assert.deepEqual(f.requests, [
    "generate-ice-servers",
    "generate-ice-servers",
    "revoke",
  ]);
  assert.deepEqual(f.revoked, [predecessor.iceServers[0].username]);
  assert.notEqual(
    predecessor.iceServers[0].username,
    successor.iceServers[0].username,
  );
  assert.ok(activeSignalPair(f.room, "guest-a", "host", next, 121_000));
});

test("a failed staged generation can be reset without disrupting its predecessor", async () => {
  const f = fixture();
  const { generation, address } = await negotiated(f);
  const predecessor = await f.issue("guest-a");
  f.advance(85_000);
  await f.handle("signal/prepare", f.context, address);
  const staged = f.room.signals["guest-a"].successor.generation;
  const successor = await f.issue("guest-a", f.context, staged);
  f.advance(15_000);
  await f.handle("signal/reset", f.context, { ...address, generation: staged });
  const { pairs } = await f.read();
  const first = pairs.find((pair) => pair.peerId === "guest-a");
  assert.equal(first.generation, generation);
  assert.notEqual(first.successor.generation, staged);
  assert.deepEqual(f.requests, [
    "generate-ice-servers",
    "generate-ice-servers",
    "revoke",
  ]);
  assert.deepEqual(f.revoked, [successor.iceServers[0].username]);
  assert.notEqual(
    predecessor.iceServers[0].username,
    successor.iceServers[0].username,
  );
  f.room.members[1].binding = "different-device";
  for (const id of [generation, staged, first.successor.generation]) {
    await assert.rejects(f.issue("guest-a", f.context, id), {
      code: "obsolete-connection",
    });
  }
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
