const { createHash, randomInt, randomUUID } = require("node:crypto");
const { createServer } = require("node:http");
const { WebSocket, WebSocketServer } = require("ws");

const MAX_PEERS = 4;
const MAX_MESSAGE = 16 * 1024 * 1024;
const ROOM_GRACE_MS = 90_000;
const MINUTE = 60_000;
const CODE = /^\d{6}$/;
const RULES = /^coop-\d+-[a-f0-9]{64}$/;
const TOKEN = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const PLAYER_ID = /^web-[a-f0-9]{32}$/;
const MEMBER_DATA = /^[a-zA-Z0-9_.:|-]*$/;
const COMMANDS = new Set([
  "pause",
  "ready",
  "speed",
  "activity",
  "action",
  "rate",
]);

const HOST_MESSAGES = new Set([
  "baseline",
  "records",
  "rejected",
  "keepalive",
  "save-result",
  "browse",
  "scenario",
  "campaign",
]);
const GUEST_MESSAGES = new Set([
  "heartbeat",
  "progress",
  "resync",
  "save-request",
  "command",
]);

class RelayError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

const requireValue = (condition, message) => {
  if (!condition) throw new RelayError(message);
};

const object = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value);
const boundedText = (value, length = 64) =>
  typeof value === "string" && value.length > 0 && value.length <= length;
const sequence = (value, minimum = 0) =>
  Number.isSafeInteger(value) && value >= minimum;

// The renderer validates scenario and simulation semantics. Bound and check the wire
// envelopes here before an untrusted roommate can reach the React shell or host worker.
function validMessage(payload, inputBytes) {
  switch (payload.kind) {
    case "command": {
      const command = payload.envelope;
      return (
        inputBytes <= 2560 &&
        object(command) &&
        boundedText(command.matchId) &&
        boundedText(command.epoch) &&
        sequence(command.sequence, 1) &&
        COMMANDS.has(command.command?.kind)
      );
    }
    case "save-request":
    case "save-result":
      return (
        inputBytes <= 4096 &&
        boundedText(payload.requestId) &&
        (payload.error === undefined || boundedText(payload.error, 2048)) &&
        (payload.suspended === undefined ||
          typeof payload.suspended === "boolean")
      );
    case "browse":
      return inputBytes <= 17 * 1024 && object(payload.browse);
    case "campaign":
      return (
        inputBytes <= 5 * 1024 &&
        (payload.campaign === undefined || object(payload.campaign))
      );
    case "scenario":
      return (
        inputBytes <= 514 * 1024 &&
        boundedText(payload.selectionKey, 256) &&
        object(payload.scenario)
      );
    case "baseline":
      return (
        boundedText(payload.matchId) &&
        boundedText(payload.epoch) &&
        sequence(payload.index) &&
        object(payload.world) &&
        payload.world.matchId === payload.matchId &&
        payload.world.epoch === payload.epoch
      );
    case "records":
      return (
        inputBytes <= 65 * 1024 &&
        boundedText(payload.matchId) &&
        boundedText(payload.epoch) &&
        sequence(payload.from, 1) &&
        Array.isArray(payload.records) &&
        payload.records.length > 0 &&
        payload.records.length <= 256
      );
    case "keepalive":
      return (
        inputBytes <= 4096 &&
        boundedText(payload.matchId) &&
        boundedText(payload.epoch) &&
        sequence(payload.revision) &&
        (payload.disconnected === undefined ||
          (Array.isArray(payload.disconnected) &&
            payload.disconnected.length <= MAX_PEERS &&
            payload.disconnected.every(
              (id) => typeof id === "string" && PLAYER_ID.test(id),
            )))
      );
    case "resync":
    case "progress":
    case "rejected":
      return (
        inputBytes <= 4096 &&
        boundedText(payload.matchId) &&
        boundedText(payload.epoch)
      );
    default:
      return inputBytes <= 512;
  }
}

// The relay owns membership and routing. Only the host runs the game simulation.
function createRelay({
  origins,
  trustProxy = false,
  roomGraceMs = ROOM_GRACE_MS,
  maxRooms = 256,
  maxConnections = 1024,
} = {}) {
  const allowedOrigins = new Set(origins);
  const rooms = new Map();
  const codes = new Map();
  const attempts = new Map();
  const server = createServer((request, response) => {
    response.writeHead(request.url === "/healthz" ? 200 : 404);
    response.end();
  });
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MESSAGE,
    perMessageDeflate: {
      serverNoContextTakeover: true,
      clientNoContextTakeover: true,
      concurrencyLimit: 4,
      threshold: 1024,
    },
  });

  function send(socket, value) {
    if (socket?.readyState !== WebSocket.OPEN) return false;
    if (socket.bufferedAmount > MAX_MESSAGE) {
      socket.terminate();
      return false;
    }
    socket.send(JSON.stringify(value));
    return true;
  }

  function state(peer) {
    const { room, id } = peer;
    const members = room
      ? [...room.members.values()].filter(
          (member) =>
            member.peer ||
            room.locked?.has(member.id) ||
            member.id === room.hostId,
        )
      : [];
    return {
      available: true,
      selfId: id,
      lobbyId: room?.id,
      inviteCode: room?.code,
      hostId: room?.hostId,
      error: room?.closed
        ? "The host closed the lobby. Resume the multiplayer save to continue."
        : room && !room.members.get(room.hostId)?.peer
          ? "The host lost connection. Waiting for them to reconnect."
          : undefined,
      members: members.map(({ id, name, ready, slot }) => ({
        id,
        name,
        ready,
        slot,
      })),
      connected: members
        .filter((member) => member.id !== id && member.peer)
        .map(({ id }) => id),
    };
  }

  function broadcast(room, except) {
    for (const { peer } of room.members.values())
      if (peer && peer !== except)
        send(peer.socket, { event: { kind: "state", state: state(peer) } });
  }

  function destroy(room) {
    rooms.delete(room.id);
    codes.delete(room.code);
    clearTimeout(room.expiration);
    room.members.delete(room.hostId);
    room.closed = true;
    // Keep the old ID in this final event so guests can finish the proper leave flow.
    broadcast(room);
    for (const member of room.members.values())
      if (member.peer) member.peer.room = undefined;
  }

  function detach(peer, explicit) {
    const { room, id } = peer;
    if (!room) return;
    peer.room = undefined;
    const member = room.members.get(id);
    if (member?.peer !== peer) return;
    member.peer = undefined;
    if (id === room.hostId) {
      if (explicit) return destroy(room);
      room.expiration = setTimeout(() => destroy(room), roomGraceMs);
      room.expiration.unref();
    } else if (!room.locked) {
      if (explicit) room.members.delete(id);
      else member.expires = Date.now() + roomGraceMs;
    }
    broadcast(room);
  }

  function attach(peer, room) {
    const member = room.members.get(peer.id) ?? {
      id: peer.id,
      name: peer.name,
    };
    if (member.peer && member.peer !== peer)
      throw new RelayError("This player is already connected in another tab.");
    if (!room.members.has(peer.id) && room.members.size >= MAX_PEERS) {
      const parked = [...room.members.values()].find(
        (entry) => !entry.peer && entry.id !== room.hostId,
      );
      requireValue(parked && !room.locked, "This lobby is full.");
      room.members.delete(parked.id);
    }
    if (peer.room && peer.room !== room) detach(peer, true);
    member.peer = peer;
    member.expires = undefined;
    room.members.set(peer.id, member);
    peer.room = room;
    if (peer.id === room.hostId) clearTimeout(room.expiration);
    // The caller receives its state in the reply before any subsequent game messages.
    return state(peer);
  }

  function limitEntry(peer) {
    const now = Date.now();
    let window = attempts.get(peer.ip);
    if (!window || now >= window.until) {
      if (attempts.size >= maxConnections * 4) {
        for (const [ip, attempt] of attempts)
          if (now >= attempt.until) attempts.delete(ip);
      }
      requireValue(
        attempts.size < maxConnections * 4,
        "The multiplayer service is busy.",
      );
      window = { count: 0, until: now + MINUTE };
      attempts.set(peer.ip, window);
    }
    requireValue(
      ++window.count <= 30,
      "Too many lobby attempts. Try again in a minute.",
    );
  }

  function handleRequest(peer, input, inputBytes) {
    requireValue(
      input && typeof input.kind === "string",
      "Invalid multiplayer request.",
    );
    if (input.kind === "hello") {
      requireValue(
        !peer.id &&
          inputBytes <= 4096 &&
          typeof input.token === "string" &&
          TOKEN.test(input.token),
        "Invalid multiplayer identity.",
      );
      const digest = createHash("sha256").update(input.token).digest("hex");
      peer.id = `web-${digest.slice(0, 32)}`;
      const name =
        typeof input.name === "string"
          ? input.name
              .replace(
                /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu,
                "",
              )
              .trim()
          : "";
      peer.name =
        [...name].slice(0, 40).join("") ||
        `Player ${digest.slice(0, 4).toUpperCase()}`;
      return state(peer);
    }
    requireValue(peer.id, "Connect to the multiplayer service first.");
    const { room, id } = peer;
    switch (input.kind) {
      case "pulse":
        return;
      case "state":
        return state(peer);
      case "create": {
        limitEntry(peer);
        requireValue(
          typeof input.rules === "string" && RULES.test(input.rules),
          "Invalid game version.",
        );
        requireValue(rooms.size < maxRooms, "The multiplayer service is busy.");
        if (room) detach(peer, true);
        let code;
        do code = String(randomInt(1_000_000)).padStart(6, "0");
        while (codes.has(code));
        const next = {
          id: randomUUID(),
          code,
          rules: input.rules,
          hostId: id,
          members: new Map(),
        };
        rooms.set(next.id, next);
        codes.set(code, next);
        return attach(peer, next);
      }
      case "join": {
        limitEntry(peer);
        requireValue(
          typeof input.lobbyId === "string" && CODE.test(input.lobbyId),
          "Enter a six-digit invite code.",
        );
        if (room) detach(peer, true);
        const next = codes.get(input.lobbyId);
        requireValue(
          next && next.members.get(next.hostId)?.peer,
          "No game found for that invite code.",
        );
        requireValue(
          input.rules === next.rules,
          "Update Electrify to the same version as your friend.",
        );
        requireValue(
          !next.locked || next.locked.has(id),
          "This game has already started.",
        );
        return attach(peer, next);
      }
      case "reconnect": {
        if (room) return state(peer);
        const previous =
          typeof input.roomId === "string" && rooms.get(input.roomId);
        const member = previous && previous.members.get(id);
        requireValue(
          member && (!member.expires || member.expires > Date.now()),
          "The lobby closed. Reopen the multiplayer save to continue.",
        );
        return attach(peer, previous);
      }
      case "leave":
        detach(peer, true);
        return state(peer);
      case "member": {
        requireValue(room, "The lobby closed.");
        const { key, value } = input;
        requireValue(
          (key === "ready" || key === "slot") &&
            typeof value === "string" &&
            value.length <= (key === "ready" ? 256 : 128) &&
            MEMBER_DATA.test(value),
          "Invalid lobby member data.",
        );
        room.members.get(id)[key] = value;
        return state(peer);
      }
      case "lock": {
        requireValue(room?.hostId === id, "Only the host can start the game.");
        const { ids, requiredIds } = input;
        requireValue(
          Array.isArray(ids) &&
            ids.length >= 2 &&
            ids.length <= MAX_PEERS &&
            new Set(ids).size === ids.length &&
            ids.includes(id) &&
            Array.isArray(requiredIds) &&
            requiredIds.length <= ids.length &&
            requiredIds.every(
              (member) =>
                ids.includes(member) && room.members.get(member)?.peer,
            ) &&
            ids.every(
              (member) => typeof member === "string" && PLAYER_ID.test(member),
            ) &&
            [...room.members.values()].every(
              (member) => !member.peer || ids.includes(member.id),
            ),
          "Wait for everyone to connect.",
        );
        // Some saved seats belong to retired companies whose players stayed away.
        room.locked = new Set(ids);
        for (const member of room.members.values())
          if (!room.locked.has(member.id)) room.members.delete(member.id);
        return;
      }
      case "unlock":
        requireValue(
          room?.hostId === id,
          "Only the host can reopen the lobby.",
        );
        room.locked = false;
        for (const [member, entry] of room.members)
          if (!entry.peer) room.members.delete(member);
        return state(peer);
      case "send": {
        const host = room?.hostId === id;
        const recipient = room?.members.get(input.to)?.peer;
        const allowed = host ? HOST_MESSAGES : GUEST_MESSAGES;
        requireValue(
          room &&
            input.to !== id &&
            (host || input.to === room.hostId) &&
            object(input.payload) &&
            allowed.has(input.payload.kind) &&
            validMessage(input.payload, inputBytes),
          "Invalid game message.",
        );
        if (
          !recipient ||
          !send(recipient.socket, {
            event: { kind: "message", sender: id, payload: input.payload },
          })
        )
          throw new RelayError("Player is disconnected", "peer-disconnected");
        return;
      }
      default:
        throw new RelayError("Unknown multiplayer request.");
    }
  }

  server.on("upgrade", (request, socket, head) => {
    if (request.url !== "/v1" || !allowedOrigins.has(request.headers.origin)) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    if (sockets.clients.size >= maxConnections) {
      socket.end(
        "HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n",
      );
      return;
    }
    sockets.handleUpgrade(request, socket, head, (websocket) => {
      // Enable this only behind an ingress that appends the verified client IP.
      const ip =
        (trustProxy &&
          request.headers["x-forwarded-for"]?.split(",").at(-1)?.trim()) ||
        request.socket.remoteAddress;
      const peer = { socket: websocket, ip };
      let alive = true;
      let budget = MAX_MESSAGE * 2;
      let lastMessage = Date.now();
      const respond = (id, result) => send(websocket, { reply: id, result });
      const timer = setInterval(() => {
        if (
          !alive ||
          !peer.id ||
          (peer.room?.locked && Date.now() - lastMessage > 5000)
        )
          return websocket.terminate();
        alive = false;
        websocket.ping();
      }, 15_000);
      timer.unref();
      websocket.on("error", () => websocket.terminate());
      websocket.on("pong", () => {
        alive = true;
      });
      websocket.on("close", () => {
        clearInterval(timer);
        detach(peer, false);
      });
      websocket.on("message", (bytes, binary) => {
        const now = Date.now();
        budget = Math.min(
          MAX_MESSAGE * 2,
          budget + (now - lastMessage) * 2_000,
        );
        lastMessage = now;
        budget -= bytes.length + 2048;
        if (binary || budget < 0)
          return websocket.close(1008, "Invalid or excessive traffic");
        let packet;
        try {
          packet = JSON.parse(bytes.toString());
        } catch {
          return websocket.close(1007, "Invalid JSON");
        }
        if (!Number.isSafeInteger(packet?.id) || packet.id < 1)
          return websocket.close(1008, "Invalid request ID");
        try {
          if (packet.input?.kind !== "send" && bytes.length > 4096)
            throw new RelayError("Invalid multiplayer request.");
          const result = handleRequest(peer, packet.input, bytes.length);
          respond(packet.id, result);
          if (
            peer.room &&
            ["join", "member", "reconnect", "unlock"].includes(
              packet.input.kind,
            )
          )
            broadcast(peer.room, peer);
        } catch (error) {
          if (!(error instanceof RelayError))
            console.error("Multiplayer relay request failed", error);
          send(websocket, {
            reply: packet.id,
            error:
              error instanceof RelayError
                ? error.message
                : "The multiplayer service could not finish the request.",
            code: error instanceof RelayError ? error.code : undefined,
          });
        }
      });
    });
  });

  server.on("close", () => {
    for (const room of rooms.values()) clearTimeout(room.expiration);
    for (const socket of sockets.clients) socket.terminate();
  });
  return { server, sockets };
}

if (require.main === module) {
  const origins = (
    process.env.COOP_RELAY_ORIGINS ||
    "https://electrifygame.com,electrify://app,http://localhost:3000"
  )
    .split(",")
    .map((origin) => origin.trim());
  const { server } = createRelay({
    origins,
    trustProxy: process.env.COOP_RELAY_TRUST_PROXY === "1",
  });
  server.listen(
    Number(process.env.PORT || 8787),
    process.env.HOST || "127.0.0.1",
    () => {
      console.log(
        `Multiplayer relay listening on port ${server.address().port}`,
      );
    },
  );
}

module.exports = { createRelay };
