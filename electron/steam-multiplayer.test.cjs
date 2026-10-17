const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  SteamMultiplayer,
  DECLARATIONS,
  loadMultiplayerFunctions,
  encode,
  chunk,
  assemble,
  stringify,
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
function fixture(directory = "unused-test-path") {
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
    directory,
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
    // A receipt for a checkpoint that never entered this connection's queue proves nothing.
    assert.equal(mp.sharedAt, null);
    mp.connections.get(100).queue = [];
    await mp.checkpoint(world);
    await mp.receive("76561198000000002", { kind: "saved", digest: "current" });
    assert.equal(mp.sharedAt, mp.checkpointAt);
  } finally {
    mp.dispose();
  }
});
test("unchanged checkpoints skip only connected peers that confirmed their queued copy", async () => {
  const { mp } = fixture();
  const first = { id: "76561198000000002", connected: true, queue: [] };
  const second = { id: "76561198000000003", connected: true, queue: [] };
  let writes = 0;
  mp.persist = async (world) => {
    mp.savedAt = ++writes;
    return world.digest;
  };
  try {
    mp.connections.set(100, first);
    mp.connections.set(101, second);
    const world = { digest: "first" };
    await mp.checkpoint(world);
    await mp.receive(first.id, { kind: "saved", digest: "first" });
    const confirmedAt = mp.sharedAt;
    first.queue = [];
    second.queue = [];
    await mp.checkpoint(world);
    assert.equal(writes, 2, "host still persists every request");
    assert.equal(first.queue.length, 0);
    assert.equal(second.queue.length, 1, "unacknowledged peers retry");
    assert.equal(mp.sharedAt, confirmedAt, "no invented remote save time");

    first.queue = [];
    second.queue = [];
    await mp.checkpoint({ digest: "changed" });
    assert.equal(first.queue.length, 1);
    assert.equal(second.queue.length, 1);
    assert.equal(first.savedDigest, undefined);
    await mp.receive(first.id, { kind: "saved", digest: "first" });
    assert.equal(
      first.savedDigest,
      undefined,
      "stale receipt cannot suppress retry",
    );
    first.connected = false;
    await mp.receive(first.id, { kind: "saved", digest: "changed" });
    assert.equal(
      first.savedDigest,
      undefined,
      "disconnected receipt cannot confirm",
    );
    first.connected = true;
    await mp.receive(first.id, { kind: "saved", digest: "changed" });
    assert.equal(first.savedDigest, "changed");
    mp.connections.set(100, { id: first.id, connected: true, queue: [] });
    await mp.checkpoint({ digest: "changed" });
    assert.equal(
      mp.connections.get(100).queue.length,
      1,
      "reconnect needs its own copy",
    );

    const queued = second.queue.length;
    mp.persist = async () => {
      throw new Error("disk unavailable");
    };
    await assert.rejects(
      mp.checkpoint({ digest: "changed" }),
      /disk unavailable/,
    );
    assert.equal(
      second.queue.length,
      queued,
      "failed host writes never publish",
    );
  } finally {
    mp.dispose();
  }
});

test("schema 2 checkpoints persist real files, including overlapping host saves and guest receipts", async () => {
  const temporaryRoot = path.resolve(".tmp", "native-tests");
  fs.mkdirSync(temporaryRoot, { recursive: true });
  const directory = fs.mkdtempSync(path.join(temporaryRoot, "checkpoint-"));
  const { mp } = fixture(directory);
  const guest = { id: "76561198000000002", connected: true, queue: [] };
  const world = {
    schema: 2,
    revision: 1,
    seats: [{ id: mp.service.identity.steamId }, { id: guest.id }],
  };
  try {
    mp.connections.set(100, guest);
    await assert.rejects(
      mp.persist({ ...world, schema: 1 }),
      /Invalid shared save/,
    );
    await Promise.all([
      mp.checkpoint(world),
      mp.checkpoint({ ...world, revision: 2 }),
    ]);
    assert.equal(JSON.parse(fs.readFileSync(mp.filename, "utf8")).revision, 2);
    assert.equal(guest.queue.length, 2);
    const messages = guest.queue.map((message) =>
      assemble(new Map(), chunk(message)),
    );
    assert.deepEqual(
      messages.map((message) => message.world.revision),
      [1, 2],
    );
    await mp.receive(guest.id, { kind: "saved", digest: messages[0].digest });
    assert.equal(guest.savedDigest, undefined);
    await mp.receive(guest.id, { kind: "saved", digest: messages[1].digest });
    assert.equal(guest.savedDigest, messages[1].digest);
    guest.queue = [];
    await mp.checkpoint({ ...world, revision: 2 });
    assert.equal(guest.queue.length, 0);

    // Exercise the actual guest persistence path, including a failed write and retry.
    mp.hostId = guest.id;
    const savedFilename = mp.filename;
    mp.filename = directory; // Writing a file over this directory must fail.
    await assert.rejects(mp.receive(guest.id, messages[1]));
    assert.equal(
      guest.queue.length,
      0,
      "failed persistence is never acknowledged",
    );
    mp.filename = savedFilename;
    await mp.receive(guest.id, messages[1]);
    assert.equal(
      fs.readFileSync(mp.filename, "utf8"),
      stringify(messages[1].world),
    );
    assert.deepEqual(assemble(new Map(), chunk(guest.queue[0])), {
      kind: "saved",
      digest: messages[1].digest,
    });
  } finally {
    mp.dispose();
    fs.rmSync(directory, { recursive: true, force: true });
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
