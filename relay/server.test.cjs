const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { once } = require("node:events");
const { test } = require("node:test");
const { WebSocket } = require("ws");
const { createRelay } = require("./server.cjs");

const RULES = `coop-1-${"a".repeat(64)}`;
const WEB = "https://electrifygame.com";
const STEAM = "electrify://app";

async function fixture(t) {
  const { server, sockets } = createRelay({ origins: [WEB, STEAM] });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `ws://127.0.0.1:${server.address().port}/v1`;
  t.after(async () => {
    for (const socket of sockets.clients) socket.terminate();
    await new Promise((resolve) => server.close(resolve));
  });
  return {
    url,
    sockets,
    async player(origin = WEB, token = randomUUID()) {
      const socket = new WebSocket(url, { origin });
      await once(socket, "open");
      const pending = new Map();
      const received = [];
      const waiting = [];
      let sequence = 0;
      socket.on("message", (raw) => {
        const { reply, result, error, code, event } = JSON.parse(
          raw.toString(),
        );
        if (reply) {
          const operation = pending.get(reply);
          pending.delete(reply);
          if (error)
            operation.reject(Object.assign(new Error(error), { code }));
          else operation.resolve(result);
        } else {
          const index = waiting.findIndex(({ accepts }) => accepts(event));
          if (index >= 0) waiting.splice(index, 1)[0].resolve(event);
          else received.push(event);
        }
      });
      function ask(input) {
        return new Promise((resolve, reject) => {
          const id = ++sequence;
          pending.set(id, { resolve, reject });
          socket.send(JSON.stringify({ id, input }));
        });
      }
      const { selfId } = await ask({ kind: "hello", token, name: "Guest" });
      return {
        selfId,
        token,
        ask,
        next(accepts) {
          const index = received.findIndex(accepts);
          return index >= 0
            ? Promise.resolve(received.splice(index, 1)[0])
            : new Promise((resolve) => waiting.push({ accepts, resolve }));
        },
        async close() {
          const closed = once(socket, "close");
          socket.close();
          await closed;
        },
      };
    },
  };
}

test(
  "Steam and web share a private roster, selection readiness, claims and messages",
  { timeout: 5000 },
  async (t) => {
    const relay = await fixture(t);
    const host = await relay.player(STEAM);
    const guest = await relay.player();
    const lobby = await host.ask({ kind: "create", rules: RULES });
    assert.match(lobby.inviteCode, /^\d{6}$/);
    const join = { kind: "join", lobbyId: lobby.inviteCode, rules: RULES };
    await assert.rejects(
      guest.ask({ ...join, rules: RULES.replace(/a$/, "b") }),
      /same version/,
    );
    const joined = await guest.ask(join);
    assert.deepEqual(joined.connected, [host.selfId]);
    assert.equal(joined.hostId, host.selfId);

    const ready = "mod|normal|42|sha256-a|sha256-b";
    const slot = `${randomUUID()}:${guest.selfId}`;
    await guest.ask({ kind: "member", key: "ready", value: ready });
    await guest.ask({ kind: "member", key: "slot", value: slot });
    const roster = await host.next(
      (event) =>
        event.kind === "state" &&
        event.state.members.some((member) => member.slot === slot),
    );
    assert.deepEqual(
      roster.state.members.find(({ id }) => id === guest.selfId),
      {
        id: guest.selfId,
        name: "Guest",
        ready,
        slot,
      },
    );

    await assert.rejects(
      guest.ask({
        kind: "send",
        to: host.selfId,
        payload: { kind: "records" },
      }),
      /Invalid game message/,
    );
    await assert.rejects(
      guest.ask({
        kind: "send",
        to: host.selfId,
        payload: { kind: "command" },
      }),
      /Invalid game message/,
    );
    const command = {
      kind: "command",
      envelope: {
        matchId: randomUUID(),
        epoch: randomUUID(),
        sequence: 1,
        command: { kind: "ready" },
      },
    };
    await guest.ask({
      kind: "send",
      to: host.selfId,
      sender: host.selfId,
      payload: command,
    });
    assert.deepEqual(await host.next((event) => event.kind === "message"), {
      kind: "message",
      sender: guest.selfId,
      payload: command,
    });

    const outsider = await relay.player();
    await assert.rejects(
      outsider.ask({ kind: "reconnect", roomId: lobby.lobbyId }),
      /lobby closed/,
    );
    await assert.rejects(
      outsider.ask({ kind: "send", to: host.selfId, payload: command }),
      /Invalid game message/,
    );
  },
);

test(
  "a disconnected guest rejoins before start and an active room can resume with an absent retired seat",
  { timeout: 5000 },
  async (t) => {
    const relay = await fixture(t);
    const host = await relay.player();
    const guest = await relay.player(STEAM);
    const retired = await relay.player();
    const lobby = await host.ask({ kind: "create", rules: RULES });
    const join = { kind: "join", lobbyId: lobby.inviteCode, rules: RULES };
    await guest.ask(join);
    await guest.close();
    await host.next(
      (event) => event.kind === "state" && event.state.members.length === 1,
    );
    const lock = {
      kind: "lock",
      ids: [host.selfId, guest.selfId, retired.selfId],
      requiredIds: [host.selfId, guest.selfId],
    };
    await assert.rejects(host.ask(lock), /Wait for everyone/);
    const reconnected = await relay.player(STEAM, guest.token);
    const state = await reconnected.ask({
      kind: "reconnect",
      roomId: lobby.lobbyId,
    });
    assert.equal(state.selfId, guest.selfId);
    assert.deepEqual(state.connected, [host.selfId]);

    await host.ask(lock);
    const stranger = await relay.player();
    await assert.rejects(stranger.ask(join), /already started/);

    await host.close();
    const paused = await reconnected.next(
      (event) =>
        event.kind === "state" && !event.state.connected.includes(lobby.selfId),
    );
    assert.deepEqual(paused.state.connected, []);
    assert.equal(paused.state.error, undefined);
    const restoredHost = await relay.player(WEB, host.token);
    const restored = await restoredHost.ask({
      kind: "reconnect",
      roomId: lobby.lobbyId,
    });
    assert.deepEqual(restored.connected, [guest.selfId]);
    const revived = await reconnected.next(
      (event) =>
        event.kind === "state" &&
        event.state.connected.includes(host.selfId) &&
        !event.state.error,
    );
    assert.equal(revived.state.lobbyId, lobby.lobbyId);
  },
);

test(
  "a rejected room switch keeps the hosted lobby open",
  { timeout: 5000 },
  async (t) => {
    const relay = await fixture(t);
    const host = await relay.player();
    const guest = await relay.player();
    const current = await host.ask({ kind: "create", rules: RULES });
    await guest.ask({
      kind: "join",
      lobbyId: current.inviteCode,
      rules: RULES,
    });
    const missing = String(
      (Number(current.inviteCode) + 1) % 1_000_000,
    ).padStart(6, "0");

    await assert.rejects(
      host.ask({ kind: "join", lobbyId: missing, rules: RULES }),
      /No game found/,
    );
    assert.deepEqual((await guest.ask({ kind: "state" })).connected, [
      host.selfId,
    ]);
    assert.equal((await host.ask({ kind: "state" })).lobbyId, current.lobbyId);

    const friend = await relay.player();
    const next = await friend.ask({ kind: "create", rules: RULES });
    const joined = await host.ask({
      kind: "join",
      lobbyId: next.inviteCode,
      rules: RULES,
    });
    assert.equal(joined.lobbyId, next.lobbyId);
    const closed = await guest.next(
      (event) => event.kind === "state" && event.state.error,
    );
    assert.equal(closed.state.lobbyId, current.lobbyId);
  },
);

test(
  "a disconnected guest can rejoin a reopened lobby",
  { timeout: 5000 },
  async (t) => {
    const relay = await fixture(t);
    const host = await relay.player();
    const guest = await relay.player();
    const current = await host.ask({ kind: "create", rules: RULES });
    await guest.ask({
      kind: "join",
      lobbyId: current.inviteCode,
      rules: RULES,
    });
    const ids = [host.selfId, guest.selfId];
    await host.ask({ kind: "lock", ids, requiredIds: ids });
    await host.ask({ kind: "unlock" });
    await guest.close();

    const disconnected = await host.next(
      (event) => event.kind === "state" && !event.state.connected.length,
    );
    assert.deepEqual(
      disconnected.state.members.map(({ id }) => id),
      [host.selfId],
    );
    const returning = await relay.player(WEB, guest.token);
    const rejoined = await returning.ask({
      kind: "reconnect",
      roomId: current.lobbyId,
    });
    assert.deepEqual(rejoined.connected, [host.selfId]);
  },
);

test(
  "a paused room stays connected on protocol heartbeats alone",
  { timeout: 5000 },
  async (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 0 });
    const relay = await fixture(t);
    const host = await relay.player();
    const guest = await relay.player();
    const current = await host.ask({ kind: "create", rules: RULES });
    await guest.ask({
      kind: "join",
      lobbyId: current.inviteCode,
      rules: RULES,
    });
    const ids = [host.selfId, guest.selfId];
    await host.ask({ kind: "lock", ids, requiredIds: ids });

    for (let heartbeat = 0; heartbeat < 2; heartbeat++) {
      const reply = Promise.all(
        [...relay.sockets.clients].map((socket) =>
          Promise.race([
            once(socket, "pong").then(() => "pong"),
            once(socket, "close").then(() => "close"),
          ]),
        ),
      );
      // A hidden tab's application timers may stop running while the browser handles Pong.
      t.mock.timers.tick(15_000);
      assert.deepEqual(await reply, ["pong", "pong"]);
    }
    assert.deepEqual((await guest.ask({ kind: "state" })).connected, [
      host.selfId,
    ]);
  },
);

test("unconfigured origins cannot connect", { timeout: 5000 }, async (t) => {
  const { url } = await fixture(t);
  const socket = new WebSocket(url, { origin: "https://example.org" });
  const [error] = await once(socket, "error");
  assert.match(error.message, /403/);
});
