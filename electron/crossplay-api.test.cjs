const assert = require("node:assert/strict");
const { test } = require("node:test");
const { randomUUID } = require("node:crypto");
const {
  createSteamCrossplayApi,
  trustedCrossplaySender,
  validateCrossplayRequest,
} = require("./crossplay-api.cjs");
const {
  LAUNCH_CALLBACK,
  TICKET_CALLBACK,
  TICKET_IDENTITY,
  observeSteamInvites,
  parseSteamInviteArgument,
  withSteamWebTicket,
} = require("./steam-crossplay.cjs");

const token = "AbCdEfGhIjKlMnOpQrStUv";
const bearer = "d".repeat(64) + "." + "B".repeat(43);
const roomId = "room-test";
const session = () => ({ token: bearer, expiresAt: Date.now() + 60_000 });
const invalid = { ok: false, code: "invalid_request" };

function mockDispatcher() {
  const handlers = new Map();
  return {
    handlers,
    onCallback(id, callback) {
      handlers.set(id, callback);
      return () => handlers.delete(id);
    },
    emit(id, payload) {
      handlers.get(id)?.(payload);
    },
  };
}

function steamTicket(handle, result, ticket) {
  const payload = Buffer.alloc(2572);
  payload.writeUInt32LE(handle, 0);
  payload.writeInt32LE(result, 4);
  payload.writeInt32LE(ticket.length, 8);
  payload.write(ticket, 12);
  return payload;
}

test("Steam ticket is matched by handle and cancelled after exchange finishes", async () => {
  const dispatcher = mockDispatcher();
  const cancelled = [];
  const opts = {
    user: "user",
    dispatcher,
    api: {
      getTicket(user, identity) {
        assert.equal(user, "user");
        assert.equal(identity, TICKET_IDENTITY);
        return 7;
      },
      cancelTicket(user, handle) {
        cancelled.push([user, handle]);
      },
    },
  };
  const result = withSteamWebTicket(opts, async (secret) => {
    assert.equal(secret, "0102");
    assert.deepEqual(cancelled, []);
    return "exchanged";
  });
  dispatcher.emit(TICKET_CALLBACK, steamTicket(8, 1, "wrong handle"));
  dispatcher.emit(TICKET_CALLBACK, steamTicket(7, 1, "\x01\x02"));
  assert.equal(await result, "exchanged");
  assert.deepEqual(cancelled, [["user", 7]]);
  assert.equal(dispatcher.handlers.size, 0);

  const failed = withSteamWebTicket(opts, () => assert.fail("invalid ticket"));
  dispatcher.emit(TICKET_CALLBACK, steamTicket(7, 2, "refused"));
  await assert.rejects(failed, /Steam ticket unavailable/);
  assert.deepEqual(cancelled, [
    ["user", 7],
    ["user", 7],
  ]);
});

test("Steam auth cancellation removes the callback and releases the ticket", async () => {
  const dispatcher = mockDispatcher();
  const controller = new AbortController();
  let cancelled = false;
  const pending = withSteamWebTicket(
    {
      user: "user",
      dispatcher,
      signal: controller.signal,
      api: {
        getTicket: () => 23,
        cancelTicket: (_, handle) => {
          assert.equal(handle, 23);
          cancelled = true;
        },
      },
    },
    () => assert.fail("cancelled ticket"),
  );
  controller.abort();
  await assert.rejects(pending, /cancelled/);
  assert.equal(dispatcher.handlers.size, 0);
  assert.equal(cancelled, true);
});

test("Steam accepts only the exact isolated launch argument on launch and callback", () => {
  const command = "--electrify-coop=" + token;
  assert.equal(parseSteamInviteArgument(command), token);
  assert.equal(parseSteamInviteArgument(command + " --other"), undefined);
  assert.equal(
    parseSteamInviteArgument("https://example.test/" + token),
    undefined,
  );
  assert.equal(parseSteamInviteArgument(command + "/"), undefined);
  assert.equal(parseSteamInviteArgument(command + "\n"), undefined);
  const dispatcher = mockDispatcher();
  const seen = [];
  let input = command;
  const stop = observeSteamInvites(
    {
      apps: () => "apps",
      getLaunchCommandLine: (_apps, buffer) => buffer.write(input),
    },
    dispatcher,
    (invite) => seen.push(invite),
  );
  assert.deepEqual(seen, [token]);
  input = command + " --other";
  dispatcher.emit(LAUNCH_CALLBACK);
  assert.deepEqual(seen, [token]);
  input = "--electrify-coop=" + "a".repeat(22);
  dispatcher.emit(LAUNCH_CALLBACK);
  stop();
  assert.deepEqual(seen, [token, "a".repeat(22)]);
});

test("IPC sender must be the current bundled top-level renderer", () => {
  const frame = { url: "electrify://app/index.html#MainMenu" };
  const content = { mainFrame: frame };
  const window = { webContents: content, isDestroyed: () => false };
  assert.equal(
    trustedCrossplaySender({ sender: content, senderFrame: frame }, window),
    true,
  );
  assert.equal(
    trustedCrossplaySender(
      { sender: { mainFrame: frame }, senderFrame: frame },
      window,
    ),
    false,
  );
  assert.equal(
    trustedCrossplaySender(
      { sender: content, senderFrame: { ...frame } },
      window,
    ),
    false,
  );
  frame.url = "electrify://app/invite/index.html";
  assert.equal(
    trustedCrossplaySender({ sender: content, senderFrame: frame }, window),
    false,
  );
  frame.url = "https://electrifygame.com/index.html";
  assert.equal(
    trustedCrossplaySender({ sender: content, senderFrame: frame }, window),
    false,
  );
});

test("Steam HTTPS bridge validates requests, keeps auth in main, and refuses redirect", async () => {
  const requests = [];
  let online = true;
  let exchanges = 0;
  const api = createSteamCrossplayApi({
    online: () => online,
    withTicket: async (exchange) => {
      exchanges++;
      return exchange("abcdef");
    },
    fetcher: async (url, options) => {
      requests.push([url, options]);
      return Response.json(
        url.endsWith("auth/steam") ? session() : { room: roomId },
      );
    },
  });
  const request = (action, body) =>
    api.request(action, body, randomUUID(), false);
  assert.deepEqual(await request("auth/steam", {}), invalid);
  assert.deepEqual(await request("https://example.test", {}), invalid);
  assert.deepEqual(
    await request("room/state", { roomId: "../other" }),
    invalid,
  );
  assert.deepEqual(
    await request("room/state", { roomId, token: bearer }),
    invalid,
  );
  assert.deepEqual(requests, []);
  assert.equal(
    validateCrossplayRequest("signal/describe", {
      roomId,
      to: "peer",
      generation: "generation",
      description: { type: "offer", sdp: "a".repeat(16_385) },
    }),
    false,
  );

  const replies = await Promise.all([
    request("room/state", { roomId }),
    request("room/state", { roomId }),
  ]);
  assert.deepEqual(
    replies,
    Array(2).fill({ ok: true, value: { room: roomId } }),
  );
  assert.equal(exchanges, 1);
  assert.equal(requests.length, 3);
  const [authUrl, auth] = requests[0];
  assert.equal(
    authUrl,
    "https://us-central1-electrify-game.cloudfunctions.net/coopV2/auth/steam",
  );
  assert.deepEqual(JSON.parse(auth.body), {
    ticket: "abcdef",
    device: JSON.parse(auth.body).device,
  });
  assert.match(JSON.parse(auth.body).device, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(auth.headers.Authorization, undefined);
  for (const [url, options] of requests.slice(1)) {
    assert.equal(
      url,
      "https://us-central1-electrify-game.cloudfunctions.net/coopV2/room/state",
    );
    assert.equal(options.headers.Authorization, "Bearer " + bearer);
    assert.equal(options.redirect, "error");
    assert.equal(options.credentials, "omit");
    assert.equal(options.cache, "no-store");
  }
  online = false;
  assert.deepEqual(await request("room/state", { roomId }), {
    ok: false,
    code: "unauthenticated",
  });
  assert.ok(requests.at(-1)[0].endsWith("/auth/revoke"));
  await api.dispose();
});

test("a replaced Steam session cannot reclaim a seat through background renewal", async () => {
  const initial = session();
  let current = Date.now();
  let exchanges = 0;
  const api = createSteamCrossplayApi({
    online: () => true,
    withTicket: async (exchange) => exchange("abcdef"),
    now: () => current,
    fetcher: async (url, options) => {
      if (!url.endsWith("/auth/steam")) return Response.json({ roomId });
      exchanges++;
      if (exchanges === 2) {
        assert.equal(options.headers.Authorization, "Bearer " + initial.token);
        return Response.json({ error: "unauthenticated" }, { status: 401 });
      }
      assert.equal(options.headers.Authorization, undefined);
      return Response.json({
        token: initial.token,
        expiresAt: current + 60_000,
      });
    },
  });

  const request = (operation, body, gesture = false) =>
    api.request(operation, body, randomUUID(), gesture);
  assert.equal((await request("room/state", { roomId })).ok, true);
  current += 50_000;
  assert.deepEqual(await request("room/state", { roomId }), {
    ok: false,
    code: "unauthenticated",
  });
  const reconnect = { roomId, rules: "version" };
  assert.deepEqual(await request("room/reconnect", reconnect), {
    ok: false,
    code: "unauthenticated",
  });
  assert.equal(exchanges, 2);
  assert.equal((await request("room/reconnect", reconnect, true)).ok, true);
  assert.equal((await request("room/state", { roomId })).ok, true);
  assert.equal(exchanges, 3);
  await api.dispose();
});

test("the HTTPS request is cancelled only for the specified renderer request ID", async () => {
  let start;
  const started = new Promise((resolve) => {
    start = resolve;
  });
  const api = createSteamCrossplayApi({
    online: () => true,
    withTicket: async (exchange) => exchange("abcdef"),
    fetcher: async (url, options) => {
      if (url.endsWith("/auth/steam")) return Response.json(session());
      if (!url.endsWith("/save/read")) return Response.json({});
      return new Promise((_, reject) => {
        options.signal.addEventListener("abort", reject, { once: true });
        start();
      });
    },
  });
  const id = randomUUID();
  const pending = api.request("save/read", { roomId }, id, false);
  await started;
  api.cancel(randomUUID());
  assert.equal(
    (await api.request("room/state", { roomId }, randomUUID(), false)).ok,
    true,
  );
  api.cancel(id);
  assert.deepEqual(await pending, { ok: false, code: "cancelled" });
  await api.dispose();
});

test("only a finished match may ask to reopen its campaign lobby", () => {
  assert.equal(validateCrossplayRequest("room/unlock", { roomId }), true);
  assert.equal(
    validateCrossplayRequest("room/unlock", { roomId, finished: true }),
    true,
  );
  for (const finished of [false, "yes", 1])
    assert.equal(
      validateCrossplayRequest("room/unlock", { roomId, finished }),
      false,
    );
  assert.equal(
    validateCrossplayRequest("room/unlock", { roomId, extra: true }),
    false,
  );
});
