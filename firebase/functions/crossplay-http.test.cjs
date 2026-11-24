const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createCrossplay } = require("./crossplay-http.cjs");

const ORIGIN = "https://electrifygame.com";
const RULES = `coop-2-${"a".repeat(64)}`;
const DEVICE = "d".repeat(43);

function setup({ steamEnabled = true, collisions = 0, campaignRules } = {}) {
  let now = 10_000;
  let stopped = false;
  const documents = new Map();
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
      consume: async () => true,
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
      signal: (_operation, { seatId }) => ({ seatId }),
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
  const upgraded = await resume(guest);
  assert.equal(upgraded.status, 200);
  assert.notEqual(upgraded.body.authority.epoch, room.authority.epoch);
  assert.deepEqual(upgraded.body.authority.head, published.body);
  assert.deepEqual((await resume(host, RULES)).body, { error: "incompatible" });
  assert.equal(
    (await resume(host)).body.authority.epoch,
    upgraded.body.authority.epoch,
  );
});

test("expired host loses publication rights and a single original seat acquires the pinned checkpoint", async () => {
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
  const next = await resume(guest);
  assert.equal(next.body.lobby.hostId, active.lobby.selfId);
  assert.equal(
    (await resume(host)).body.authority.epoch,
    next.body.authority.epoch,
  );
  assert.notEqual(next.body.authority.epoch, room.authority.epoch);
  assert.deepEqual(next.body.authority.head, published.body);
  assert.equal(
    (await ctx.call("save/publish", { roomId }, { token: host })).status,
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
});

test("a late suspend cannot invalidate a newer foreground binding", async () => {
  const ctx = setup();
  const host = await ctx.login("host");
  const room = await ctx.create(host);
  const roomId = room.lobby.lobbyId;
  const old = room.authority.presence;
  assert.equal(
    (await ctx.call("room/suspend", { roomId, presence: old }, { token: host }))
      .status,
    200,
  );
  const paused = await ctx.call("room/state", { roomId }, { token: host });
  assert.equal(paused.body.authority.leaseRemainingMs, 0);
  const reconnected = await ctx.call(
    "room/reconnect",
    { roomId, rules: RULES },
    { token: host },
  );
  assert.equal(reconnected.body.authority.epoch, room.authority.epoch);
  assert.notEqual(reconnected.body.authority.presence, old);
  assert.equal(
    (await ctx.call("room/suspend", { roomId, presence: old }, { token: host }))
      .status,
    200,
  );
  const current = await ctx.call("room/state", { roomId }, { token: host });
  assert.ok(current.body.authority.leaseRemainingMs > 0);
});
