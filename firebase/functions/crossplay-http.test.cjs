const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createCrossplay } = require("./crossplay-http.cjs");
const { createTurnSignaling } = require("./coop-signaling.cjs");

const ORIGIN = "https://electrifygame.com";
const RULES = `coop-2-${"a".repeat(64)}`;
const DEVICE = "d".repeat(43);

function setup({
  steamEnabled = true,
  collisions = 0,
  campaignRules,
  turn = false,
} = {}) {
  let now = 10_000;
  const signaling = turn
    ? createTurnSignaling({
        db: {
          collection: () => ({ doc: () => ({}) }),
          doc: () => ({}),
        },
        keyId: "key",
        keyToken: "test-token",
        loadRoom: async () => null,
        clock: () => now,
      })
    : null;
  let stopped = false;
  let inviteFailures = 0;
  const documents = new Map();
  const quotas = [];
  const inviteCodes = new Map();
  const accounts = new Map();
  const tickets = new Set();
  const steamCalls = [];
  const audits = [];
  const current = (id) => ({
    room: documents.has(id) ? structuredClone(documents.get(id)) : null,
    snapshot: documents.get(id),
    now,
  });
  const service = createCrossplay({
    origins: [ORIGIN],
    quotaKey: "fixture-does-not-leave-unit-tests",
    campaignRules,
    clock: () => now,
    audit: (event) => audits.push(event),
    isStopped: async () => stopped,
    verifyGoogle: async (token) => {
      const [provider, uid] = token.split(":");
      return { uid, firebase: { sign_in_provider: provider } };
    },
    verifySteam: steamEnabled
      ? async (ticket) => {
          steamCalls.push(ticket);
          return "76561198000000000";
        }
      : undefined,
    store: {
      account: async (id) => accounts.get(id),
      accounts: async (ids) => ids.map((id) => accounts.get(id)),
      consume: async (entries) => {
        quotas.push(...entries.map((entry) => entry.id));
        return true;
      },
      consumeTicket: async (digest) => {
        if (tickets.has(digest)) return false;
        tickets.add(digest);
        return true;
      },
      issue: async (id, next) => {
        const previous = accounts.get(id);
        const retain =
          previous?.deviceHash === next.deviceHash &&
          !previous.revoked &&
          (previous.expiresAt > now || next.priorTokenHash !== undefined);
        if (
          next.priorTokenHash !== undefined &&
          (!retain || next.priorTokenHash !== previous.tokenHash)
        )
          return null;
        if (retain) next.binding = previous.binding;
        accounts.set(id, next);
        return next.binding;
      },
      revoke: async (id, tokenHash) => {
        const data = accounts.get(id);
        if (data?.tokenHash === tokenHash) data.revoked = true;
      },
      reserveRoom: async () => true,
      reserveInviteCode: async (digest, id, expiresAt) => {
        if (inviteFailures > 0) {
          inviteFailures--;
          return false;
        }
        if (collisions > 0) {
          collisions--;
          return false;
        }
        if (inviteCodes.get(digest)?.expiresAt > now) return false;
        inviteCodes.set(digest, { id, expiresAt });
        return true;
      },
      getRoom: async (id) => current(id),
      findInvite: async (digest, shortCode) => {
        if (shortCode) {
          const code = inviteCodes.get(digest);
          return code?.expiresAt > now ? current(code.id) : null;
        }
        const selected = [...documents.values()].find(
          (room) =>
            room.invite?.codeHash === digest ||
            room.invite?.linkHash === digest,
        );
        return selected ? current(selected.id) : null;
      },
      listRooms: async (account) =>
        [...documents.values()]
          .filter((room) =>
            room.members.some((member) => member.account === account),
          )
          .map((room) => current(room.id)),
      writeRoom: async (version, room, actor) => {
        const account = accounts.get(actor.account);
        if (account?.tokenHash !== actor.tokenHash || account.revoked)
          return false;
        if (documents.get(room.id) !== (version ?? undefined)) return false;
        documents.set(room.id, structuredClone(room));
        return true;
      },
    },
    extensions: {
      save: (operation, context) => {
        if (operation === "save/read") return context.room.head;
        return context.updateRoom((room) => {
          room.head = {
            name: "Confirmed campaign",
            revision: 1,
            matchId: "match",
            schema: 3,
            gameSchema: 27,
            rules: room.rules,
            epoch: room.epoch,
            savedAt: now,
          };
          return { room, value: room.head };
        }, "host");
      },
      signal: signaling
        ? (operation, context, body) =>
            signaling.handle(operation, context, body)
        : (_operation, { seatId }) => ({ seatId }),
    },
  });

  async function call(
    operation,
    body,
    { token, origin = ORIGIN, method = "POST", headers = {} } = {},
  ) {
    const observed = {};
    const requestHeaders = {
      origin,
      "content-type": "application/json",
      ...(token && { authorization: `Bearer ${token}` }),
      ...headers,
    };
    await service.handle(
      {
        originalUrl: `/coopV2/${operation}`,
        path: `/${operation}`,
        socket: { remoteAddress: "127.0.0.1" },
        get: (key) => requestHeaders[key],
        rawBody: Buffer.from(JSON.stringify(body)),
        method,
      },
      {
        set: (name, value) => (observed[name] = value),
        status(code) {
          observed.status = code;
          return this;
        },
        json: (result) => (observed.body = result),
      },
    );
    return observed;
  }

  async function login(user, { device = DEVICE, token } = {}) {
    const result = await call(
      "auth/google",
      { token: `google.com:${user}`, device },
      { token },
    );
    assert.equal(result.status, 200);
    return result.body.token;
  }

  async function create(token) {
    const reply = await call(
      "room/create",
      { name: "Host", rules: RULES },
      { token },
    );
    assert.equal(reply.status, 200);
    return reply.body;
  }

  async function join(room, token, invite = room.lobby.inviteCode) {
    return call(
      "room/join",
      { name: "Guest", rules: RULES, invite },
      { token },
    );
  }

  async function joinPlayer(room, token, invite) {
    const reply = await join(room, token, invite);
    assert.equal(reply.status, 200);
    return reply.body;
  }

  return {
    advance(ms) {
      now += ms;
    },
    shutdown() {
      stopped = true;
    },
    audits,
    steamCalls,
    joinPlayer,
    call,
    create,
    join,
    login,
    failInvites(count) {
      inviteFailures = count;
    },
    documents,
    quotas,
  };
}

test("provider proofs have an explicit origin, provider identity, replay gate and cache policy", async () => {
  const ctx = setup();
  const failedProvider = await ctx.call("auth/google", {
    token: "apple.com:player",
    device: DEVICE,
  });
  assert.equal(failedProvider.status, 401);
  assert.equal(failedProvider["Cache-Control"], "no-store");
  const disallowed = await ctx.call(
    "auth/google",
    {
      token: "google.com:player",
      device: DEVICE,
    },
    { origin: "https://beta.electrifygame.com" },
  );
  assert.equal(disallowed.status, 403);
  assert.equal(disallowed["Access-Control-Allow-Origin"], undefined);
  const ticket = "1a".repeat(64);
  const steamProof = { ticket, device: DEVICE };
  assert.equal((await ctx.call("auth/steam", steamProof)).status, 403);
  assert.equal(
    (await ctx.call("auth/steam", steamProof, { origin: null })).status,
    200,
  );
  assert.equal(
    (await ctx.call("auth/steam", steamProof, { origin: null })).status,
    401,
  );
  assert.equal(ctx.steamCalls.length, 1);
});

test("web-only deployment lets Google players host and join without Steam configuration", async () => {
  const ctx = setup({ steamEnabled: false });
  assert.equal((await ctx.call("healthz", {}, { method: "GET" })).status, 200);
  const host = await ctx.login("host");
  const guest = await ctx.login("guest");
  const room = await ctx.create(host);
  assert.equal(
    (
      await ctx.call(
        "room/state",
        { roomId: room.lobby.lobbyId },
        { token: guest },
      )
    ).status,
    404,
  );
  const approved = await ctx.joinPlayer(room, guest);
  assert.ok(approved.lobby.selfId);
  assert.equal(approved.lobby.members.length, 2);

  const steam = await ctx.call(
    "auth/steam",
    { ticket: "1a".repeat(64), device: DEVICE },
    { origin: null },
  );
  assert.equal(steam.status, 503);
  assert.equal(ctx.steamCalls.length, 0);
});

test("authenticated invitations admit directly and keep lobby identity and secrets private", async () => {
  const ctx = setup({ collisions: 1 });
  const host = await ctx.login("host-id");
  const guest = await ctx.login("guest-id");
  const room = await ctx.create(host);
  const roomId = room.lobby.lobbyId;
  assert.match(room.lobby.inviteCode, /^[a-z0-9]{6}$/);
  assert.match(room.lobby.inviteToken, /^[A-Za-z0-9_-]{22}$/);
  assert.ok(room.lobby.inviteVersion);
  for (const operation of ["room/state", "signal/read", "save/read"]) {
    const unauthorized = await ctx.call(
      operation,
      { roomId },
      { token: guest },
    );
    assert.ok([403, 404].includes(unauthorized.status));
  }
  const rejected = await ctx.call("room/join", {
    name: "Guest",
    rules: RULES,
    invite: room.lobby.inviteToken,
  });
  assert.equal(rejected.status, 401);
  assert.equal((await ctx.join(room, guest, "nope")).status, 404);
  const joined = await ctx.joinPlayer(
    room,
    guest,
    room.lobby.inviteCode.toUpperCase(),
  );
  assert.equal(joined.lobby.members.length, 2);
  assert.match(joined.lobby.selfId, /^[a-f0-9-]{36}$/);
  assert.equal(joined.lobby.inviteToken, undefined);
  assert.doesNotMatch(
    JSON.stringify(joined),
    /host-id|guest-id|tokenHash|codeHash/,
  );
  const fromLink = await ctx.joinPlayer(
    room,
    await ctx.login("from-link"),
    room.lobby.inviteToken,
  );
  assert.equal(fromLink.lobby.members.length, 3);
  const race = await Promise.all(
    (await Promise.all([ctx.login("first"), ctx.login("second")])).map(
      (token) => ctx.join(room, token),
    ),
  );
  assert.deepEqual(race.map(({ status }) => status).sort(), [200, 409]);
  assert.equal(
    race.find(({ status }) => status === 409).body.error,
    "room_full",
  );
});

test("the host renews an expired lobby invite while the old link and code stop working", async () => {
  const ctx = setup();
  const host = await ctx.login("host");
  const guest = await ctx.login("guest");
  const room = await ctx.create(host);
  const roomId = room.lobby.lobbyId;
  let token = host;
  let state;
  for (let index = 1; index <= 225; index++) {
    ctx.advance(4000);
    if (index % 60 === 0) token = await ctx.login("host", { token });
    state = await ctx.call("room/state", { roomId }, { token });
    assert.equal(state.status, 200);
  }
  assert.notEqual(state.body.lobby.inviteVersion, room.lobby.inviteVersion);
  assert.match(state.body.lobby.inviteCode, /^[a-z0-9]{6}$/);
  const retried = await ctx.call("room/state", { roomId }, { token });
  assert.equal(retried.body.lobby.inviteCode, state.body.lobby.inviteCode);
  assert.equal(retried.body.lobby.inviteToken, state.body.lobby.inviteToken);
  const freshGuest = await ctx.login("guest");
  assert.notEqual(freshGuest, guest);
  assert.equal((await ctx.join(room, freshGuest)).status, 404);
  assert.equal(
    (await ctx.join(room, freshGuest, room.lobby.inviteToken)).status,
    404,
  );
  const joined = await ctx.joinPlayer(state.body, freshGuest);
  assert.equal(joined.lobby.inviteCode, undefined);
  assert.equal(joined.lobby.inviteToken, undefined);
});

test("an invite roll failure still commits the host lease", async () => {
  const ctx = setup();
  const host = await ctx.login("host");
  const room = await ctx.create(host);
  const roomId = room.lobby.lobbyId;
  let token = host;
  for (let index = 1; index <= 224; index++) {
    ctx.advance(4000);
    if (index % 60 === 0) token = await ctx.login("host", { token });
    assert.equal(
      (await ctx.call("room/state", { roomId }, { token })).status,
      200,
    );
  }
  ctx.failInvites(8);
  ctx.advance(4000);
  const state = await ctx.call("room/state", { roomId }, { token });
  assert.equal(state.status, 200);
  assert.equal(state.body.authority.leaseRemainingMs, 12_000);
  assert.equal(state.body.lobby.inviteCode, undefined);
});

test("same-device renewal preserves a seat, and a fenced device cannot renew back into play", async () => {
  const ctx = setup();
  let host = await ctx.login("host");
  const room = await ctx.create(host);
  const roomId = room.lobby.lobbyId;
  const bind = room.authority.binding;
  host = await ctx.login("host", { token: host });
  const active = await ctx.call("room/state", { roomId }, { token: host });
  assert.equal(active.body.authority.binding, bind);

  ctx.advance(5 * 60_000 + 1);
  host = await ctx.login("host", { token: host });
  const renewed = await ctx.call(
    "room/reconnect",
    { roomId, rules: RULES },
    { token: host },
  );
  assert.equal(renewed.body.authority.binding, bind);

  const replacement = await ctx.login("host", { device: "r".repeat(43) });
  const stale = await ctx.call(
    "auth/google",
    {
      token: "google.com:host",
      device: DEVICE,
    },
    { token: host },
  );
  assert.equal(stale.status, 401);
  assert.equal(
    (await ctx.call("room/state", { roomId }, { token: host })).status,
    401,
  );
  const fenced = await ctx.call(
    "room/reconnect",
    { roomId, rules: RULES },
    { token: replacement },
  );
  assert.deepEqual(fenced.body, { error: "host_lease_held" });
  ctx.advance(12_001);
  const acquired = await ctx.call(
    "room/reconnect",
    { roomId, rules: RULES },
    { token: replacement },
  );
  assert.equal(acquired.status, 200);
  assert.equal(acquired.body.lobby.selfId, room.lobby.selfId);
  assert.notEqual(acquired.body.authority.epoch, room.authority.epoch);
});

test("only the host of a finished match can reopen its saved campaign for another game", async () => {
  const ctx = setup();
  const host = await ctx.login("host");
  const guest = await ctx.login("guest");
  const room = await ctx.create(host);
  const { lobby } = await ctx.joinPlayer(room, guest);
  const roomId = lobby.lobbyId;
  const ids = lobby.members.map(({ id }) => id);
  const lock = (token) =>
    ctx.call("room/lock", { roomId, ids, requiredIds: ids }, { token });
  assert.equal((await lock(host)).status, 200);
  // Before anything is saved the lobby simply reopens, as it always did.
  assert.equal(
    (await ctx.call("room/unlock", { roomId }, { token: host })).status,
    200,
  );
  assert.equal((await lock(host)).status, 200);
  assert.equal(
    (await ctx.call("save/publish", { roomId }, { token: host })).status,
    200,
  );
  // A saved campaign belongs to its original players until its host says the match is finished.
  const refused = await ctx.call("room/unlock", { roomId }, { token: host });
  assert.equal(refused.status, 409);
  assert.deepEqual(refused.body, { error: "roster_locked" });
  for (const body of [{ finished: false }, { finished: "yes" }, { extra: 1 }])
    assert.equal(
      (await ctx.call("room/unlock", { roomId, ...body }, { token: host }))
        .status,
      400,
    );
  assert.equal(
    (
      await ctx.call(
        "room/unlock",
        { roomId, finished: true },
        { token: guest },
      )
    ).status,
    403,
  );
  const reopened = await ctx.call(
    "room/unlock",
    { roomId, finished: true },
    { token: host },
  );
  assert.equal(reopened.status, 200);
  assert.equal(reopened.body.authority.locked, false);
  assert.ok(!reopened.body.authority.head);
  // The same players start again: a new roster lock and a fresh first checkpoint.
  assert.equal((await lock(host)).status, 200);
  assert.equal(
    (await ctx.call("save/publish", { roomId }, { token: host })).status,
    200,
  );
});

test("only an original player can upgrade an expired saved campaign to the deployed build", async () => {
  const current = `coop-2-${"b".repeat(64)}`;
  const ctx = setup({ campaignRules: { current, published: { [RULES]: 27 } } });
  const host = await ctx.login("host");
  const guest = await ctx.login("guest");
  const outsider = await ctx.login("outsider");
  const room = await ctx.create(host);
  const { lobby } = await ctx.joinPlayer(room, guest);
  const roomId = lobby.lobbyId;
  const ids = lobby.members.map(({ id }) => id);
  const resume = (token, rules = current) =>
    ctx.call("room/reconnect", { roomId, rules }, { token });
  assert.equal(
    (
      await ctx.call(
        "room/lock",
        { roomId, ids, requiredIds: ids },
        { token: host },
      )
    ).status,
    200,
  );
  const published = await ctx.call("save/publish", { roomId }, { token: host });
  assert.equal(published.status, 200);
  assert.deepEqual((await resume(guest)).body, { error: "incompatible" });
  ctx.advance(12_001);
  assert.equal((await resume(outsider)).status, 403);
  assert.deepEqual((await resume(guest, `coop-2-${"c".repeat(64)}`)).body, {
    error: "incompatible",
  });
  assert.deepEqual((await resume(guest)).body, { error: "incompatible" });
  const upgraded = await resume(host);
  assert.equal(upgraded.status, 200);
  assert.notEqual(upgraded.body.authority.epoch, room.authority.epoch);
  assert.deepEqual(upgraded.body.authority.head, published.body);
  assert.equal(upgraded.body.lobby.hostId, room.lobby.selfId);
});

test("a published checkpoint stays resumable after an intermediate build acquires it", async () => {
  const intermediate = `coop-2-${"b".repeat(64)}`;
  const current = `coop-2-${"c".repeat(64)}`;
  const rules = { current: intermediate, published: { [RULES]: 27 } };
  const ctx = setup({ campaignRules: rules });
  const host = await ctx.login("host");
  const guest = await ctx.login("guest");
  const room = await ctx.create(host);
  const { lobby } = await ctx.joinPlayer(room, guest);
  const roomId = lobby.lobbyId;
  const ids = lobby.members.map(({ id }) => id);
  assert.equal(
    (
      await ctx.call(
        "room/lock",
        { roomId, ids, requiredIds: ids },
        { token: host },
      )
    ).status,
    200,
  );
  const published = await ctx.call("save/publish", { roomId }, { token: host });
  assert.equal(published.status, 200);
  ctx.advance(12_001);
  const stepped = await ctx.call(
    "room/reconnect",
    { roomId, rules: intermediate },
    { token: host },
  );
  assert.equal(stepped.status, 200);
  assert.equal(stepped.body.authority.head.rules, RULES);
  assert.equal(stepped.body.authority.head.gameSchema, 27);
  rules.current = current;
  ctx.advance(12_001);
  const upgraded = await ctx.call(
    "room/reconnect",
    { roomId, rules: current },
    { token: host },
  );
  assert.equal(upgraded.status, 200);
  assert.deepEqual(upgraded.body.authority.head, published.body);
  assert.notEqual(upgraded.body.authority.epoch, stepped.body.authority.epoch);
});

test("an expired campaign stays with the original host", async () => {
  const ctx = setup();
  const host = await ctx.login("host");
  const guest = await ctx.login("guest");
  const outsider = await ctx.login("elsewhere");
  const room = await ctx.create(host);
  const active = await ctx.joinPlayer(room, guest);
  const roomId = room.lobby.lobbyId;
  const ids = active.lobby.members.map(({ id }) => id);
  assert.equal(
    (
      await ctx.call(
        "room/lock",
        { roomId, ids, requiredIds: ids },
        { token: guest },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await ctx.call(
        "room/lock",
        { roomId, ids, requiredIds: ids },
        { token: host },
      )
    ).status,
    200,
  );
  const published = await ctx.call("save/publish", { roomId }, { token: host });
  assert.equal(published.status, 200);
  ctx.advance(12_001);
  assert.equal(
    (await ctx.call("save/publish", { roomId }, { token: host })).status,
    409,
  );
  assert.deepEqual(
    (await ctx.call("save/read", { roomId }, { token: guest })).body,
    published.body,
  );
  assert.equal(
    (await ctx.call("save/read", { roomId }, { token: outsider })).status,
    403,
  );
  const resume = async (token) =>
    ctx.call("room/reconnect", { roomId, rules: RULES }, { token });
  const guestNext = await resume(guest);
  assert.notEqual(guestNext.body.lobby.hostId, active.lobby.selfId);
  assert.equal(guestNext.body.authority.leaseRemainingMs, 0);
  const next = await resume(host);
  assert.equal(next.body.lobby.hostId, room.lobby.selfId);
  assert.notEqual(next.body.authority.epoch, room.authority.epoch);
  assert.deepEqual(next.body.authority.head, published.body);
  assert.equal(
    (await ctx.call("save/publish", { roomId }, { token: guest })).status,
    403,
  );
  assert.equal(
    (await ctx.call("room/withdraw", { roomId }, { token: host })).status,
    200,
  );
  assert.equal(
    (await ctx.call("save/read", { roomId }, { token: host })).status,
    403,
  );
  ctx.shutdown();
  assert.equal(
    (await ctx.call("save/read", { roomId }, { token: guest })).status,
    503,
  );
});

test("a guest can reclaim their seat and the host can remove them from that lobby", async () => {
  const ctx = setup();
  const host = await ctx.login("host");
  const guest = await ctx.login("guest");
  const room = await ctx.create(host);
  const roomId = room.lobby.lobbyId;
  const joined = await ctx.joinPlayer(room, guest);
  const newDevice = await ctx.login("guest", { device: "e".repeat(43) });
  const reclaimed = await ctx.join(room, newDevice);
  assert.equal(reclaimed.status, 200);
  assert.equal(reclaimed.body.lobby.selfId, joined.lobby.selfId);
  const removed = await ctx.call(
    "room/remove",
    { roomId, seatId: joined.lobby.selfId },
    { token: host },
  );
  assert.equal(removed.status, 200);
  assert.equal(removed.body.lobby.members.length, 1);
  assert.equal((await ctx.join(room, newDevice)).status, 404);
  assert.equal(
    (await ctx.join(room, newDevice, room.lobby.inviteToken)).status,
    404,
  );
  const anotherGuest = await ctx.login("another");
  assert.equal((await ctx.join(room, anotherGuest)).status, 200);
});

test("an expired guest presence cannot borrow the live host lease", async () => {
  const ctx = setup();
  const host = await ctx.login("host");
  const guest = await ctx.login("guest");
  const room = await ctx.create(host);
  const roomId = room.lobby.lobbyId;
  await ctx.joinPlayer(room, guest);
  ctx.advance(7000);
  const hostState = await ctx.call("room/state", { roomId }, { token: host });
  assert.ok(hostState.body.authority.leaseRemainingMs > 6000);
  ctx.advance(6000);
  const guestState = await ctx.call("room/state", { roomId }, { token: guest });
  assert.equal(guestState.body.authority.leaseRemainingMs, 0);
  const returned = await ctx.call(
    "room/reconnect",
    { roomId, rules: RULES },
    { token: guest },
  );
  assert.ok(returned.body.authority.leaseRemainingMs > 0);
  assert.notEqual(returned.body.lobby.hostId, returned.body.lobby.selfId);
});

test("a late suspend cannot invalidate a newer foreground binding", async () => {
  const ctx = setup();
  const host = await ctx.login("host");
  const room = await ctx.create(host);
  const roomId = room.lobby.lobbyId;
  const old = room.authority.presence;
  ctx.documents.get(roomId).signals = { keep: { generation: "stay" } };
  assert.equal(
    (await ctx.call("room/suspend", { roomId, presence: old }, { token: host }))
      .status,
    200,
  );
  assert.equal(ctx.documents.get(roomId).signals.keep.generation, "stay");
  assert.equal(ctx.documents.get(roomId).members[0].away, true);
  const paused = await ctx.call("room/state", { roomId }, { token: host });
  assert.ok(paused.body.authority.leaseRemainingMs > 0);
  assert.equal(ctx.documents.get(roomId).signals.keep.generation, "stay");
  const reconnected = await ctx.call(
    "room/reconnect",
    { roomId, rules: RULES },
    { token: host },
  );
  assert.equal(reconnected.body.authority.epoch, room.authority.epoch);
  assert.notEqual(reconnected.body.authority.presence, old);
  ctx.documents.get(roomId).signals = { keep: { generation: "stay" } };
  assert.equal(
    (await ctx.call("room/suspend", { roomId, presence: old }, { token: host }))
      .status,
    200,
  );
  assert.equal(ctx.documents.get(roomId).signals.keep.generation, "stay");
  const current = await ctx.call("room/state", { roomId }, { token: host });
  assert.ok(current.body.authority.leaseRemainingMs > 0);
  assert.equal(ctx.documents.get(roomId).signals.keep.generation, "stay");
  assert.notEqual(ctx.documents.get(roomId).members[0].away, true);
});

test("a hidden host does not renew the lease until they return", async () => {
  const ctx = setup();
  const host = await ctx.login("host");
  const room = await ctx.create(host);
  const roomId = room.lobby.lobbyId;
  const presence = room.authority.presence;
  ctx.advance(5_000);
  assert.equal(
    (await ctx.call("room/suspend", { roomId, presence }, { token: host }))
      .status,
    200,
  );
  const parked = ctx.documents.get(roomId).leaseUntil;
  await ctx.call("room/state", { roomId }, { token: host });
  assert.equal(ctx.documents.get(roomId).leaseUntil, parked);
  assert.equal(ctx.documents.get(roomId).members[0].away, true);
  assert.equal(
    (await ctx.call("room/resume", { roomId, presence }, { token: host }))
      .status,
    200,
  );
  assert.equal(ctx.documents.get(roomId).members[0].away, undefined);
  ctx.advance(5_000);
  await ctx.call("room/state", { roomId }, { token: host });
  assert.ok(ctx.documents.get(roomId).leaseUntil > parked);
});

test("a late suspend cannot mark a returned host away", async () => {
  const ctx = setup();
  const host = await ctx.login("host");
  const room = await ctx.create(host);
  const roomId = room.lobby.lobbyId;
  const presence = room.authority.presence;
  assert.equal(
    (
      await ctx.call(
        "room/suspend",
        { roomId, presence, seq: 1 },
        { token: host },
      )
    ).status,
    200,
  );
  assert.equal(ctx.documents.get(roomId).members[0].away, true);
  ctx.advance(5_000);
  const parked = ctx.documents.get(roomId).leaseUntil;
  assert.equal(
    (
      await ctx.call(
        "room/resume",
        { roomId, presence, seq: 2 },
        { token: host },
      )
    ).status,
    200,
  );
  assert.ok(ctx.documents.get(roomId).leaseUntil > parked);
  const extended = ctx.documents.get(roomId).leaseUntil;
  assert.equal(
    (
      await ctx.call(
        "room/suspend",
        { roomId, presence, seq: 1 },
        { token: host },
      )
    ).status,
    200,
  );
  assert.equal(ctx.documents.get(roomId).members[0].away, undefined);
  assert.equal(ctx.documents.get(roomId).leaseUntil, extended);
});

test("rate limits use the address appended by the front end", async () => {
  const ctx = setup();
  const body = { token: "google.com:caller", device: DEVICE };
  const addresses = async (forwarded) => {
    const before = ctx.quotas.length;
    assert.equal(
      (
        await ctx.call("auth/google", body, {
          headers: { "x-forwarded-for": forwarded },
        })
      ).status,
      200,
    );
    return ctx.quotas.slice(before).filter((id) => id.startsWith("auth-ip-"));
  };
  const spoofed = await addresses("198.51.100.9, 203.0.113.10");
  const again = await addresses("203.0.113.44, 203.0.113.10");
  const other = await addresses("203.0.113.10, 203.0.113.11");
  assert.equal(spoofed[0], again[0]);
  assert.notEqual(spoofed[0], other[0]);
  process.env.COOP_TRUSTED_PROXY_HOPS = "1";
  try {
    const skipped = await addresses("198.51.100.9, 203.0.113.10, 192.0.2.8");
    assert.equal(skipped[0], spoofed[0]);
  } finally {
    delete process.env.COOP_TRUSTED_PROXY_HOPS;
  }
});

test("a hidden guest keeps the relay pair while the host lease is live", async () => {
  const ctx = setup({ turn: true });
  const host = await ctx.login("host");
  const guest = await ctx.login("guest");
  const room = await ctx.create(host);
  const roomId = room.lobby.lobbyId;
  const joined = await ctx.joinPlayer(room, guest);
  const guestId = joined.lobby.selfId;
  const first = await ctx.call("signal/read", { roomId }, { token: host });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const generation = first.body.pairs.find(
    (pair) => pair.peerId === guestId,
  ).generation;
  assert.equal(
    (
      await ctx.call(
        "room/suspend",
        { roomId, presence: joined.authority.presence },
        { token: guest },
      )
    ).status,
    200,
  );
  ctx.advance(5_000);
  const renewed = await ctx.call("room/state", { roomId }, { token: host });
  assert.equal(renewed.status, 200);
  assert.ok(renewed.body.authority.leaseRemainingMs > 0);
  ctx.advance(8_000);
  const still = await ctx.call("room/state", { roomId }, { token: host });
  assert.ok(still.body.authority.leaseRemainingMs > 0);
  const read = await ctx.call("signal/read", { roomId }, { token: host });
  assert.equal(read.status, 200, JSON.stringify(read.body));
  assert.equal(
    read.body.pairs.find((pair) => pair.peerId === guestId)?.generation,
    generation,
  );
  assert.equal(
    ctx.documents.get(roomId).signals[guestId].generation,
    generation,
  );
});
