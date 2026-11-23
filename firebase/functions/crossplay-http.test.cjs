const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createCrossplay } = require("./crossplay-http.cjs");
const { googlePlaytestAccounts } = require("./crossplay-identity.cjs");

const ORIGIN = "https://electrifygame.com";
const RULES = `coop-2-${"a".repeat(64)}`;
const DEVICE = "d".repeat(43);

function setup({ steamEnabled = true, webTesterUids } = {}) {
  let now = 10_000;
  let stopped = false;
  const documents = new Map();
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
    clock: () => now,
    audit: (event) => audits.push(event),
    readAccess: async () => ({
      stopped,
      allowedAccounts: steamEnabled
        ? undefined
        : googlePlaytestAccounts(webTesterUids),
    }),
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
          previous.expiresAt > now;
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
      getRoom: async (id) => current(id),
      findInvite: async (digest) => {
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

  async function approve(room, host, guest) {
    const roomId = room.lobby.lobbyId;
    const pending = await join(room, guest);
    assert.equal(pending.body.lobby.joinPending, true);
    assert.deepEqual(pending.body.lobby.members, []);
    const reply = await call("room/state", { roomId }, { token: host });
    const [request] = reply.body.lobby.pendingApprovals;
    const accepted = await call(
      "room/approve",
      {
        roomId,
        requestId: request.id,
        approve: true,
      },
      { token: host },
    );
    assert.equal(accepted.status, 200);
    return (await call("room/state", { roomId }, { token: guest })).body;
  }

  return {
    advance(ms) {
      now += ms;
    },
    shutdown() {
      stopped = true;
    },
    setWebTesters(uids) {
      webTesterUids = uids;
    },
    audits,
    steamCalls,
    approve,
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

test("web-only deployment admits the named Google testers and fences removed accounts", async () => {
  const ctx = setup({ steamEnabled: false });
  const health = () => ctx.call("healthz", {}, { method: "GET" });
  const google = (uid) =>
    ctx.call("auth/google", { token: `google.com:${uid}`, device: DEVICE });

  assert.equal((await health()).status, 503);
  assert.equal((await google("host")).status, 403);
  ctx.setWebTesters(["host", "host"]);
  assert.equal((await health()).status, 503);
  ctx.setWebTesters(["host", "guest"]);
  assert.equal((await health()).status, 200);
  assert.equal((await google("outsider")).status, 403);

  const host = await ctx.login("host");
  const guest = await ctx.login("guest");
  const room = await ctx.create(host);
  await ctx.join(room, guest);
  await ctx.approve(room, host, guest);
  ctx.setWebTesters(["host", "replacement"]);
  assert.equal((await ctx.call("room/list", {}, { token: guest })).status, 403);
  assert.equal(
    (
      await ctx.call(
        "save/read",
        { roomId: room.lobby.lobbyId },
        { token: guest },
      )
    ).status,
    403,
  );
  assert.equal((await ctx.call("room/list", {}, { token: host })).status, 200);

  const steam = await ctx.call(
    "auth/steam",
    { ticket: "1a".repeat(64), device: DEVICE },
    { origin: null },
  );
  assert.equal(steam.status, 503);
  assert.equal(ctx.steamCalls.length, 0);
  ctx.shutdown();
  assert.equal((await health()).status, 503);
  assert.equal((await google("host")).status, 503);
});

test("only host approval exposes the opaque roster and invite rotation invalidates previous requests", async () => {
  const ctx = setup();
  const host = await ctx.login("host-id");
  const guest = await ctx.login("guest-id");
  const room = await ctx.create(host);
  const roomId = room.lobby.lobbyId;
  assert.match(room.lobby.inviteCode, /^[a-f0-9]{20}$/);
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
  const pending = await ctx.join(room, guest, room.lobby.inviteToken);
  assert.deepEqual(pending.body, {
    lobby: {
      available: true,
      lobbyId: roomId,
      members: [],
      connected: [],
      joinPending: true,
    },
    authority: null,
    connections: [],
  });
  assert.equal(
    (await ctx.call("signal/read", { roomId }, { token: guest })).status,
    403,
  );
  const rotated = (
    await ctx.call("room/rotate-invite", { roomId }, { token: host })
  ).body;
  assert.notEqual(rotated.lobby.inviteVersion, room.lobby.inviteVersion);
  assert.equal((await ctx.join(room, guest)).status, 404);
  const approval = await ctx.approve(rotated, host, guest);
  assert.equal(approval.lobby.members.length, 2);
  assert.match(approval.lobby.selfId, /^[a-f0-9-]{36}$/);
  assert.equal(approval.lobby.inviteToken, undefined);
  assert.doesNotMatch(
    JSON.stringify(approval),
    /host-id|guest-id|tokenHash|codeHash/,
  );
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

test("expired host loses publication rights and a single original seat acquires the pinned checkpoint", async () => {
  const ctx = setup();
  const host = await ctx.login("host");
  const guest = await ctx.login("guest");
  const outsider = await ctx.login("elsewhere");
  const room = await ctx.create(host);
  const active = await ctx.approve(room, host, guest);
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

test("a guest can cancel pending approval and reclaim their approved seat on another device", async () => {
  const ctx = setup();
  const host = await ctx.login("host");
  const guest = await ctx.login("guest");
  const room = await ctx.create(host);
  const roomId = room.lobby.lobbyId;
  await ctx.join(room, guest);
  const state = await ctx.call("room/state", { roomId }, { token: host });
  const [request] = state.body.lobby.pendingApprovals;
  assert.equal(
    (await ctx.call("room/leave", { roomId }, { token: guest })).status,
    200,
  );
  assert.equal(
    (
      await ctx.call(
        "room/approve",
        {
          roomId,
          requestId: request.id,
          approve: true,
        },
        { token: host },
      )
    ).status,
    404,
  );
  const approved = await ctx.approve(room, host, guest);
  const newDevice = await ctx.login("guest", { device: "e".repeat(43) });
  const reclaimed = await ctx.join(room, newDevice);
  assert.equal(reclaimed.status, 200);
  assert.equal(reclaimed.body.lobby.selfId, approved.lobby.selfId);
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
