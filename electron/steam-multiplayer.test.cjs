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
test("shared bundles round-trip through bounded chunks in any order and validate the checksum", async () => {
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
    result = (await assemble(pending, frame)) || result;
  assert.deepEqual(result, source);
  assert.equal(pending.size, 0);
  const corrupt = Buffer.from(frames[0]);
  corrupt[20] ^= 1;
  const damaged = new Map();
  await assert.rejects(async () => {
    for (const frame of [corrupt, ...frames.slice(1)])
      await assemble(damaged, frame);
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
const SCENARIO_BYTES = 512 * 1024;
function framesFor(message) {
  const frames = [];
  while (message.offset * 32768 < message.bytes.length) {
    frames.push(chunk(message));
    message.offset++;
  }
  return frames;
}
async function roundTrip(payload) {
  const pending = new Map();
  let result;
  for (const frame of framesFor(encode(payload)))
    result = (await assemble(pending, frame)) || result;
  assert.equal(pending.size, 0);
  return result;
}
function rawMessage(json, magic = "ELS1") {
  const crypto = require("node:crypto");
  const bytes = require("node:zlib").deflateRawSync(json);
  return {
    bytes,
    hash: crypto.createHash("sha256").update(bytes).digest(),
    id: crypto.randomBytes(8),
    offset: 0,
    magic,
  };
}
test("scenario transfers have an exact 512KiB snapshot ceiling and bounded envelope", async () => {
  const scenario = { id: 999, text: "" };
  scenario.text = "x".repeat(
    SCENARIO_BYTES - Buffer.byteLength(JSON.stringify(scenario)),
  );
  assert.equal(Buffer.byteLength(JSON.stringify(scenario)), SCENARIO_BYTES);
  const payload = {
    kind: "scenario",
    selectionKey: "999|Manager|sha256-digest",
    scenario,
  };
  const message = encode(payload);
  assert.throws(
    () =>
      encode({
        ...payload,
        scenario: { ...scenario, text: scenario.text + "x" },
      }),
    /scenario.*large/i,
  );
  assert.equal(chunk(message).toString("ascii", 0, 4), "ELS1");
  assert.deepEqual(await roundTrip(payload), payload);
  assert.throws(
    () => encode({ ...payload, selectionKey: "x".repeat(257) }),
    /scenario/i,
  );
  assert.throws(() => encode({ ...payload, extra: true }), /scenario/i);
  assert.throws(
    () => encode({ ...payload, scenario: { value: Infinity } }),
    /scenario/i,
  );
  assert.throws(
    () => encode({ ...payload, scenario: { value: () => "code" } }),
    /scenario/i,
  );
  // World transport keeps its separate larger allowance.
  assert.equal(
    (
      await roundTrip({
        kind: "view",
        view: { text: "x".repeat(SCENARIO_BYTES * 2) },
      })
    ).view.text.length,
    SCENARIO_BYTES * 2,
  );
});
test("scenario bombs stop at the streaming limit and generic-frame relabelling is rejected", async () => {
  const payload = {
    kind: "scenario",
    selectionKey: "ready",
    scenario: { text: "x".repeat(SCENARIO_BYTES * 4) },
  };
  const bomb = rawMessage(JSON.stringify(payload));
  const pending = new Map();
  let completion;
  for (const frame of framesFor(bomb))
    completion = assemble(pending, frame) || completion;
  await assert.rejects(
    async () => await completion,
    /scenario.*large|decompress.*limit/i,
  );
  assert.equal(pending.size, 0);
  const disguised = rawMessage(JSON.stringify(payload), "ELM2");
  let relabelled;
  const generic = new Map();
  for (const frame of framesFor(disguised))
    relabelled = assemble(generic, frame) || relabelled;
  await assert.rejects(relabelled, /frame.*kind|kind.*frame/i);
  assert.equal(generic.size, 0);
  const wrongKind = rawMessage(JSON.stringify({ kind: "view", view: {} }));
  await assert.rejects(
    assemble(new Map(), chunk(wrongKind)),
    /frame.*kind|kind.*frame/i,
  );
  const duplicateKind = rawMessage(
    '{"kind":"view","view":{},"kind":"scenario","scenario":{},"selectionKey":"ready"}',
    "ELM2",
  );
  await assert.rejects(
    assemble(new Map(), chunk(duplicateKind)),
    /frame.*kind|kind.*frame/i,
  );
});
test("streaming rejects a one-byte scenario overrun before end and stops relabelled bombs in their first chunk", async () => {
  const zlib = require("node:zlib");
  const descriptor = Object.getOwnPropertyDescriptor(zlib, "createInflateRaw");
  const stats = [];
  Object.defineProperty(zlib, "createInflateRaw", {
    ...descriptor,
    value: (...args) => {
      const inflater = descriptor.value(...args);
      const stat = { bytes: 0, ended: false };
      stats.push(stat);
      inflater.on("data", (part) => {
        stat.bytes += part.length;
      });
      inflater.on("end", () => {
        stat.ended = true;
      });
      return inflater;
    },
  });
  try {
    const scenario = { text: "" };
    scenario.text = "x".repeat(
      SCENARIO_BYTES + 1 - Buffer.byteLength(JSON.stringify(scenario)),
    );
    const payload = { kind: "scenario", selectionKey: "ready", scenario };
    const oneByte = rawMessage(JSON.stringify(payload));
    await assert.rejects(
      assemble(new Map(), chunk(oneByte)),
      /decompression limit/,
    );
    assert.equal(stats[0].ended, false);
    assert(stats[0].bytes <= SCENARIO_BYTES + 1024 + 16 * 1024);
    const huge = rawMessage(
      JSON.stringify({
        ...payload,
        scenario: { text: "x".repeat(SCENARIO_BYTES * 4) },
      }),
    );
    await assert.rejects(
      assemble(new Map(), chunk(huge)),
      /decompression limit/,
    );
    assert.equal(stats[1].ended, false);
    assert(stats[1].bytes <= SCENARIO_BYTES + 1024 + 16 * 1024);
    const relabelled = { ...huge, magic: "ELM2" };
    await assert.rejects(assemble(new Map(), chunk(relabelled)), /frame kind/);
    assert.equal(stats[2].ended, false);
    assert(stats[2].bytes <= 16 * 1024);
  } finally {
    Object.defineProperty(zlib, "createInflateRaw", descriptor);
  }
});
test("scenario malformed, truncated, mixed-class and unsafe envelopes never deliver partial data", async () => {
  const valid = {
    kind: "scenario",
    selectionKey: "ready",
    scenario: {
      id: 999,
      text: require("node:crypto").randomBytes(45000).toString("hex"),
    },
  };
  const frames = framesFor(encode(valid));
  assert(frames.length > 1);
  const pending = new Map();
  assert.equal(await assemble(pending, frames[0]), undefined);
  const mixed = Buffer.from(frames[1]);
  mixed.write("ELM2");
  assert.throws(() => assemble(pending, mixed), /Inconsistent/);
  const truncated = rawMessage(
    JSON.stringify({
      kind: "scenario",
      selectionKey: "ready",
      scenario: {},
    }).slice(0, -2),
  );
  await assert.rejects(assemble(new Map(), chunk(truncated)), /JSON/);
  const nonfinite = rawMessage(
    '{"kind":"scenario","selectionKey":"ready","scenario":{"value":1e999}}',
  );
  await assert.rejects(assemble(new Map(), chunk(nonfinite)), /scenario/i);
  const malformedUtf8 = rawMessage(
    Buffer.concat([
      Buffer.from(
        '{"kind":"scenario","selectionKey":"ready","scenario":{"text":"',
      ),
      Buffer.from([0xc0, 0xaf]),
      Buffer.from('"}}'),
    ]),
  );
  await assert.rejects(
    assemble(new Map(), chunk(malformedUtf8)),
    /encoded|UTF-8/i,
  );
  const cut = rawMessage(JSON.stringify(valid));
  cut.bytes = cut.bytes.subarray(0, cut.bytes.length - 1);
  cut.hash = require("node:crypto")
    .createHash("sha256")
    .update(cut.bytes)
    .digest();
  const incomplete = new Map();
  let failure;
  for (const frame of framesFor(cut))
    failure = assemble(incomplete, frame) || failure;
  await assert.rejects(failure, /unexpected end|invalid/i);
  assert.equal(incomplete.size, 0);
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
function pumpFrames(mp, api, frames) {
  clearInterval(mp.timer);
  mp.lastRefresh = Date.now();
  let supplied = false;
  const released = [];
  api.receive = (_sockets, _handle, pointers) => {
    if (supplied) return 0;
    supplied = true;
    frames.forEach((_frame, index) =>
      pointers.writeBigUInt64LE(BigInt(index + 1), index * 8),
    );
    return frames.length;
  };
  api.release = (pointer) => released.push(pointer);
  mp.koffi.decode = (pointer) => {
    const numeric = Number(pointer);
    if (numeric >= 1000) return frames[numeric - 1000];
    const prefix = Buffer.alloc(16);
    prefix.writeBigUInt64LE(BigInt(numeric - 1 + 1000), 0);
    prefix.writeInt32LE(frames[numeric - 1].length, 8);
    return prefix;
  };
  const connection = {
    id: mp.hostId,
    connected: true,
    queue: [],
    incoming: new Map(),
  };
  mp.connections.set(100, connection);
  return { connection, released };
}
test(
  "asynchronous inflation preserves reliable message order and releases native pointers",
  { timeout: 2000 },
  async () => {
    const { mp, api, events } = fixture();
    mp.hostId = "76561198000000002";
    const first = {
      kind: "view",
      view: { revision: 1, text: "x".repeat(SCENARIO_BYTES * 2) },
    };
    const second = { kind: "browse", browse: { revision: 2 } };
    const { released } = pumpFrames(mp, api, [
      ...framesFor(encode(first)),
      ...framesFor(encode(second)),
    ]);
    try {
      const delivered = new Promise((resolve) => {
        mp.emit = (event) => {
          events.push(event);
          if (events.filter((e) => e.kind === "message").length === 2)
            resolve();
        };
      });
      mp.pump();
      await delivered;
      assert.deepEqual(
        events.filter((e) => e.kind === "message").map((e) => e.payload.kind),
        ["view", "browse"],
      );
      assert.equal(released.length, 2);
    } finally {
      mp.dispose();
    }
  },
);
test("a departed connection cancels active inflaters without delivering a stale scenario", async () => {
  const { mp, api, events } = fixture();
  mp.hostId = "76561198000000002";
  const source = {
    kind: "scenario",
    selectionKey: "ready",
    scenario: { text: "x".repeat(SCENARIO_BYTES - 100) },
  };
  const { connection, released } = pumpFrames(
    mp,
    api,
    framesFor(encode(source)),
  );
  try {
    mp.pump();
    const closed = [...connection.incoming.values()].map(
      (transfer) =>
        new Promise((resolve) => transfer.inflater.once("close", resolve)),
    );
    assert.equal(closed.length, 1);
    mp.drop(100);
    await Promise.all(closed);
    assert.equal(connection.incoming.size, 0);
    assert.equal(released.length, 1);
    assert.equal(
      events.some((event) => event.kind === "message"),
      false,
    );
  } finally {
    mp.dispose();
  }
});
test("a rejected frame releases the remaining batch without restarting a departed connection", async () => {
  const { mp, api, events } = fixture();
  mp.hostId = "76561198000000002";
  const good = framesFor(
    encode({ kind: "scenario", selectionKey: "ready", scenario: { id: 999 } }),
  )[0];
  const bad = Buffer.from(good);
  bad.write("FAIL");
  const { connection, released } = pumpFrames(mp, api, [bad, good]);
  try {
    mp.pump();
    assert.equal(mp.connections.has(100), false);
    const active = connection.incoming.size;
    // Let any incorrectly restarted inflater settle so this red fixture leaves no work behind.
    await connection.delivery;
    assert.equal(active, 0);
    assert.equal(released.length, 2);
    assert.equal(
      events.some((event) => event.kind === "message"),
      false,
    );
  } finally {
    mp.dispose();
  }
});
test("campaign management exposes deletion but no rename, import or export requests", async () => {
  const { mp } = fixture();
  try {
    let deleted;
    mp.saves = {
      remove: async (id) => {
        deleted = id;
      },
      list: async () => ({ slots: [] }),
    };
    for (const kind of ["rename-save", "import-save", "export-save"])
      await assert.rejects(
        mp.request({ kind, id: "campaign", name: "Renamed" }),
        /Unknown multiplayer request/,
      );
    assert.deepEqual(
      await mp.request({ kind: "delete-save", id: "campaign" }),
      {
        slots: [],
      },
    );
    assert.equal(deleted, "campaign");
  } finally {
    mp.dispose();
  }
});
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
    matchId: "campaign-one",
    revision: 1,
    seats: [{ id: mp.service.identity.steamId }, { id: guest.id }],
  };
  try {
    mp.connections.set(100, guest);
    await assert.rejects(
      mp.persist({ ...world, schema: 1 }),
      /Invalid multiplayer save/,
    );
    await Promise.all([
      mp.checkpoint(world),
      mp.checkpoint({ ...world, revision: 2 }),
    ]);
    assert.equal(JSON.parse(fs.readFileSync(mp.filename, "utf8")).revision, 2);
    assert.equal(guest.queue.length, 2);
    const messages = await Promise.all(
      guest.queue.map((message) => assemble(new Map(), chunk(message))),
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
    const savedFilename = mp.saves.filename;
    mp.saves.filename = directory; // Writing a library over this directory must fail.
    await assert.rejects(mp.receive(guest.id, messages[1]));
    assert.equal(
      guest.queue.length,
      0,
      "failed persistence is never acknowledged",
    );
    mp.saves.filename = savedFilename;
    await mp.receive(guest.id, messages[1]);
    assert.equal(
      fs.readFileSync(mp.filename, "utf8"),
      stringify(messages[1].world),
    );
    assert.deepEqual(await assemble(new Map(), chunk(guest.queue[0])), {
      kind: "saved",
      digest: messages[1].digest,
    });
  } finally {
    mp.dispose();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
test("healthy named campaigns checkpoint while a corrupt or newer legacy file stays untouched", async () => {
  const temporaryRoot = path.resolve(".tmp", "native-tests");
  fs.mkdirSync(temporaryRoot, { recursive: true });
  const directory = fs.mkdtempSync(
    path.join(temporaryRoot, "legacy-protection-"),
  );
  const { mp } = fixture(directory);
  const world = {
    schema: 3,
    gameSchema: 3,
    matchId: "current",
    seats: [{ id: mp.service.identity.steamId }, { id: "76561198000000002" }],
  };
  try {
    await mp.persist(world);
    const future = stringify({ ...world, gameSchema: 99 });
    fs.writeFileSync(mp.filename, future);
    await mp.persist({ ...world, matchId: "another" });
    assert.equal(fs.readFileSync(mp.filename, "utf8"), future);
    fs.writeFileSync(mp.filename, "damaged legacy JSON");
    await mp.persist({ ...world, revision: 2 });
    assert.equal(fs.readFileSync(mp.filename, "utf8"), "damaged legacy JSON");
    assert.equal((await mp.saves.list()).slots.length, 2);
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
test("only the host mirrors a bounded campaign invitation roster", async () => {
  const { mp, events } = fixture();
  const campaign = {
    id: "界".repeat(64),
    name: "界".repeat(80),
    players: Array.from({ length: 4 }, (_, index) => ({
      id: `${index}${"1".repeat(63)}`,
      name: "界".repeat(200),
    })),
    requiredPlayerIds: Array.from(
      { length: 4 },
      (_, index) => `${index}${"1".repeat(63)}`,
    ),
  };
  try {
    await assert.rejects(
      mp.receive("76561198000000002", { kind: "campaign", campaign }),
      /guest message/,
    );
    mp.hostId = "76561198000000002";
    await mp.receive(mp.hostId, { kind: "campaign", campaign });
    assert.equal(events.at(-1).payload.kind, "campaign");
    await assert.rejects(
      mp.receive(mp.hostId, {
        kind: "campaign",
        campaign: { ...campaign, padding: "x".repeat(4096) },
      }),
      /campaign selection/,
    );
  } finally {
    mp.dispose();
  }
});
test("only the host delivers bounded scenario snapshots and invalid data never reaches the renderer", async () => {
  const { mp, events } = fixture();
  const payload = {
    kind: "scenario",
    selectionKey: "ready",
    scenario: { id: 999 },
  };
  try {
    await assert.rejects(
      mp.receive("76561198000000002", payload),
      /guest message/,
    );
    assert.equal(events.length, 0);
    mp.hostId = "76561198000000002";
    await assert.rejects(mp.receive("76561198000000003", payload), /sender/);
    await mp.receive(mp.hostId, payload);
    assert.equal(events.at(-1).payload, payload);
    const count = events.length;
    await assert.rejects(
      mp.receive(mp.hostId, {
        ...payload,
        scenario: { text: "x".repeat(SCENARIO_BYTES) },
      }),
      /scenario.*large/i,
    );
    await assert.rejects(
      mp.receive(mp.hostId, { ...payload, selectionKey: "<script>" }),
      /scenario/i,
    );
    assert.equal(events.length, count);
  } finally {
    mp.dispose();
  }
});
test("digest-based Ready stamps fit within 256 ASCII bytes without widening saved slots", async () => {
  const { mp, api } = fixture();
  const written = [];
  api.setMemberData = (_self, _lobby, key, value) => written.push([key, value]);
  try {
    await mp.request({ kind: "member", key: "ready", value: "a".repeat(256) });
    assert.equal(written[0][1].length, 256);
    await assert.rejects(
      mp.request({ kind: "member", key: "ready", value: "a".repeat(257) }),
      /member data/,
    );
    await assert.rejects(
      mp.request({ kind: "member", key: "slot", value: "a".repeat(65) }),
      /member data/,
    );
    assert.equal(written.length, 1);
  } finally {
    mp.dispose();
  }
});
test("players may set only their Ready selection and saved company, and only the host reopens the lobby", async () => {
  const { mp, api } = fixture();
  const written = [];
  api.setMemberData = (_self, _lobby, key, value) => written.push([key, value]);
  try {
    await mp.request({ kind: "member", key: "ready", value: "101|Manager|0" });
    await mp.request({
      kind: "member",
      key: "slot",
      value: "0123456789abcdef0123456789abcdef:76561198000000002",
    });
    assert.deepEqual(written, [
      ["ready", "101|Manager|0"],
      ["slot", "0123456789abcdef0123456789abcdef:76561198000000002"],
    ]);
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

test("guest sleep checkpoint requests carry only a validated boolean safety flag", async () => {
  const { mp, events } = fixture();
  try {
    await mp.receive("76561198000000002", {
      kind: "save-request",
      requestId: "sleep",
      suspended: true,
    });
    assert.equal(events.at(-1).payload.suspended, true);
    await assert.rejects(
      mp.receive("76561198000000002", {
        kind: "save-request",
        requestId: "sleep",
        suspended: "yes",
      }),
      /Invalid save request/,
    );
  } finally {
    mp.dispose();
  }
});
