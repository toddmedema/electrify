const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  SteamMultiplayer,
  DECLARATIONS,
  loadMultiplayerFunctions,
  encode,
  chunk,
  assemble,
  lobbyFromArgs,
} = require("./steam-multiplayer.cjs");
test("Steam lobby codes preserve the full uint64, including 18-digit invites", () => {
  assert.equal(
    lobbyFromArgs(["game", "+connect_lobby", "109775242999999999"]),
    "109775242999999999",
  );
  assert.equal(
    lobbyFromArgs(["game", "+connect_lobby", "18446744073709551616"]),
    undefined,
  );
  assert.equal(lobbyFromArgs(["game", "+connect_lobby", "-1"]), undefined);
});

test("all modern lobby, identity and NetworkingSockets exports resolve in the pinned SDK", () => {
  assert.deepEqual(
    Object.keys(loadMultiplayerFunctions()),
    Object.keys(DECLARATIONS),
  );
});
test("the real SDK identity accessors preserve every bit of a SteamID64", () => {
  const api = loadMultiplayerFunctions();
  const identity = Buffer.alloc(136);
  api.setIdentity(identity, 76561198000000002n);
  assert.equal(api.getIdentity(identity), 76561198000000002n);
});
test("shared bundles round-trip through bounded chunks in any order and validate the checksum", () => {
  const source = {
    kind: "checkpoint",
    text: require("node:crypto").randomBytes(180000).toString("hex"),
  };
  const message = encode(source),
    frames = [];
  while (message.offset * 32768 < message.bytes.length) {
    frames.push(chunk(message));
    message.offset++;
  }
  assert(frames.length > 1);
  const pending = new Map();
  let result;
  for (const frame of frames.reverse())
    result = assemble(pending, frame) || result;
  assert.deepEqual(result, source);
  assert.equal(pending.size, 0);
  const corrupt = Buffer.from(frames[0]);
  corrupt[20] ^= 1;
  const damaged = new Map();
  assert.throws(() => {
    for (const frame of [corrupt, ...frames.slice(1)]) assemble(damaged, frame);
  }, /checksum|Inconsistent/);
});
test("malformed frame lengths and incomplete message floods are rejected before allocation", () => {
  const message = encode({ kind: "view", view: { revision: 1 } }),
    frame = chunk(message);
  const oversized = Buffer.from(frame);
  oversized.writeUInt32LE(0xffffffff, 16);
  assert.throws(() => assemble(new Map(), oversized), /bounds/);
  assert.throws(() => assemble(new Map(), Buffer.alloc(10)), /frame/);
  const corrupted = Buffer.from(frame);
  corrupted[20] ^= 1;
  assert.throws(() => assemble(new Map(), corrupted), /checksum/);
});
function fixture() {
  const events = [],
    calls = [];
  const api = {
    matchmaking: () => "matchmaking",
    sockets: () => "sockets",
    utils: () => "utils",
    relay: () => {},
    members: () => 2,
    member: (_self, _lobby, i) =>
      BigInt(i ? "76561198000000002" : "76561198000000001"),
    memberData: () => "",
    owner: () => 76561198000000001n,
    info: (_self, _handle, buffer) => {
      buffer.writeInt32LE(1, 176);
      buffer.writeUInt32LE(42, 144);
      return true;
    },
    getIdentity: () => 76561198000000002n,
    accept: (_self, handle) => {
      calls.push(["accept", handle]);
      return 1;
    },
    close: (_self, handle) => calls.push(["close", handle]),
    leave: () => {},
    closeListen: () => {},
  };
  const service = {
    identity: { steamId: "76561198000000001" },
    native: { friends: () => "friends", persona: () => "Player" },
  };
  const dispatcher = {
    onCallback: (_id, fn) => {
      calls.push(["callback", fn]);
      return () => {};
    },
  };
  const mp = new SteamMultiplayer(
    service,
    dispatcher,
    "unused-test-path",
    (event) => events.push(event),
    api,
    {},
  );
  mp.lobby = 109775242999999999n;
  mp.hostId = service.identity.steamId;
  return { mp, api, calls, events };
}
test("incoming connections use authenticated Steam identity and locked membership", () => {
  const { mp, api, calls } = fixture();
  try {
    const callback = Buffer.alloc(4);
    callback.writeUInt32LE(123);
    mp.connectionChanged(callback);
    assert.deepEqual(calls.at(-1), ["accept", 123]);
    api.getIdentity = () => 76561198000000003n;
    callback.writeUInt32LE(124);
    mp.connectionChanged(callback);
    assert.deepEqual(calls.at(-1), ["close", 124]);
    mp.allowed = new Set(["76561198000000001"]);
    callback.writeUInt32LE(125);
    api.getIdentity = () => 76561198000000002n;
    mp.connectionChanged(callback);
    assert.deepEqual(calls.at(-1), ["close", 125]);
  } finally {
    mp.dispose();
  }
});
test("guests can send only commands to the host, never another player's view", async () => {
  const { mp, events } = fixture();
  try {
    await assert.rejects(
      mp.receive("76561198000000002", { kind: "view", view: {} }),
      /guest message/,
    );
    await assert.rejects(
      mp.receive("76561198000000002", {
        kind: "keepalive",
        matchId: "match",
        epoch: "epoch",
        revision: 1,
      }),
      /guest message/,
    );
    await mp.receive("76561198000000002", {
      kind: "command",
      envelope: {
        matchId: "match",
        epoch: "epoch",
        sequence: 1,
        command: { kind: "pause" },
      },
    });
    assert.equal(events.at(-1).sender, "76561198000000002");
    assert.throws(
      () => mp.send("76561198000000003", { kind: "command" }),
      /disconnected/,
    );
  } finally {
    mp.dispose();
  }
});
test("a stalled renderer expires its authenticated connection and pauses the party", () => {
  const { mp, calls, events } = fixture();
  try {
    mp.lastRefresh = Date.now();
    mp.connections.set(100, {
      id: "76561198000000002",
      connected: true,
      lastHeartbeat: performance.now() - 6000,
      incoming: new Map(),
      queue: [],
    });
    mp.pump();
    assert.deepEqual(calls.at(-1), ["close", 100]);
    assert(
      events.some(
        (event) =>
          event.kind === "disconnected" && event.sender === "76561198000000002",
      ),
    );
  } finally {
    mp.dispose();
  }
});

test("host keepalives reach guests only from the authenticated host identity", async () => {
  const { mp, events } = fixture();
  mp.hostId = "76561198000000002";
  const payload = {
    kind: "keepalive",
    matchId: "match",
    epoch: "epoch",
    revision: 1,
  };
  try {
    await assert.rejects(mp.receive("76561198000000003", payload), /sender/);
    assert.equal(events.length, 0);
    await mp.receive(mp.hostId, payload);
    assert.deepEqual(events.at(-1), {
      kind: "message",
      sender: mp.hostId,
      payload,
    });
  } finally {
    mp.dispose();
  }
});
test("a reconnecting player replaces its stale connection instead of being refused", () => {
  const { mp, calls, events } = fixture();
  try {
    mp.connections.set(100, {
      id: "76561198000000002",
      connected: true,
      lastHeartbeat: performance.now(),
      incoming: new Map(),
      queue: [],
    });
    const callback = Buffer.alloc(4);
    callback.writeUInt32LE(101);
    mp.connectionChanged(callback);
    assert.deepEqual(calls.at(-2), ["close", 100]);
    assert.deepEqual(calls.at(-1), ["accept", 101]);
    assert.deepEqual([...mp.connections.keys()], [101]);
    assert(events.some((event) => event.kind === "disconnected"));
  } finally {
    mp.dispose();
  }
});
test("a stale save acknowledgement and a backed-up guest never fail the host's save", async () => {
  const { mp, events } = fixture();
  try {
    mp.persist = async () => "current";
    mp.connections.set(100, {
      id: "76561198000000002",
      connected: true,
      lastHeartbeat: performance.now(),
      incoming: new Map(),
      queue: Array.from({ length: 64 }, () => ({ kind: "command", offset: 0 })),
    });
    const world = { schema: 1, seats: [] };
    await mp.checkpoint(world);
    assert.equal(mp.checkpointHash, "current");
    await mp.receive("76561198000000002", { kind: "saved", digest: "older" });
    assert.equal(mp.sharedAt, null);
    assert(!events.some((event) => event.kind === "message"));
    await mp.receive("76561198000000002", { kind: "saved", digest: "current" });
    assert.equal(mp.sharedAt, mp.checkpointAt);
  } finally {
    mp.dispose();
  }
});
test("only the host mirrors a bounded scenario selection to its guests", async () => {
  const { mp, events } = fixture();
  const browse = { session: "s", revision: 1, card: "NEW_GAME" };
  try {
    await assert.rejects(
      mp.receive("76561198000000002", { kind: "browse", browse }),
      /guest message/,
    );
    mp.hostId = "76561198000000002";
    await mp.receive(mp.hostId, { kind: "browse", browse });
    assert.equal(events.at(-1).payload.kind, "browse");
    await assert.rejects(
      mp.receive(mp.hostId, {
        kind: "browse",
        browse: { ...browse, padding: "x".repeat(17 * 1024) },
      }),
      /scenario selection/,
    );
  } finally {
    mp.dispose();
  }
});
test("players may set only their Ready selection, and only the host reopens the lobby", async () => {
  const { mp, api } = fixture();
  const written = [];
  api.setMemberData = (_self, _lobby, key, value) => written.push([key, value]);
  try {
    await mp.request({ kind: "member", key: "ready", value: "101|Manager|0" });
    assert.deepEqual(written, [["ready", "101|Manager|0"]]);
    await assert.rejects(
      mp.request({ kind: "member", key: "location", value: "SF" }),
      /member data/,
    );
    await assert.rejects(
      mp.request({ kind: "member", key: "ready", value: "<script>" }),
      /member data/,
    );
    await mp.request({
      kind: "lock",
      ids: ["76561198000000001", "76561198000000002"],
    });
    await mp.request({ kind: "unlock" });
    assert.equal(mp.allowed, null);
    mp.hostId = "76561198000000002";
    await assert.rejects(mp.request({ kind: "unlock" }), /Only the host/);
  } finally {
    mp.dispose();
  }
});
