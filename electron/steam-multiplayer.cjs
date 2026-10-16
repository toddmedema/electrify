const crypto = require("node:crypto");
const zlib = require("node:zlib");
const path = require("node:path");
const { atomicWriteAsync, readJson } = require("./storage.cjs");
const { nativeLibraryPath } = require("./steam-native.cjs");

// Valve flat API, the SDK bundled with steamworks.js. No second callback consumer.
const DECLARATIONS = {
  matchmaking: "void * SteamAPI_SteamMatchmaking_v009()",
  sockets: "void * SteamAPI_SteamNetworkingSockets_SteamAPI_v012()",
  utils: "void * SteamAPI_SteamNetworkingUtils_SteamAPI_v004()",
  relay: "void SteamAPI_ISteamNetworkingUtils_InitRelayNetworkAccess(void *)",
  create: "uint64_t SteamAPI_ISteamMatchmaking_CreateLobby(void *, int, int)",
  join: "uint64_t SteamAPI_ISteamMatchmaking_JoinLobby(void *, uint64_t)",
  leave: "void SteamAPI_ISteamMatchmaking_LeaveLobby(void *, uint64_t)",
  members:
    "int SteamAPI_ISteamMatchmaking_GetNumLobbyMembers(void *, uint64_t)",
  member:
    "uint64_t SteamAPI_ISteamMatchmaking_GetLobbyMemberByIndex(void *, uint64_t, int)",
  owner: "uint64_t SteamAPI_ISteamMatchmaking_GetLobbyOwner(void *, uint64_t)",
  data: "const char * SteamAPI_ISteamMatchmaking_GetLobbyData(void *, uint64_t, const char *)",
  setData:
    "bool SteamAPI_ISteamMatchmaking_SetLobbyData(void *, uint64_t, const char *, const char *)",
  memberData:
    "const char * SteamAPI_ISteamMatchmaking_GetLobbyMemberData(void *, uint64_t, uint64_t, const char *)",
  setMemberData:
    "void SteamAPI_ISteamMatchmaking_SetLobbyMemberData(void *, uint64_t, const char *, const char *)",
  invite:
    "void SteamAPI_ISteamFriends_ActivateGameOverlayInviteDialog(void *, uint64_t)",
  listen:
    "uint32_t SteamAPI_ISteamNetworkingSockets_CreateListenSocketP2P(void *, int, int, void *)",
  connect:
    "uint32_t SteamAPI_ISteamNetworkingSockets_ConnectP2P(void *, void *, int, int, void *)",
  accept:
    "int SteamAPI_ISteamNetworkingSockets_AcceptConnection(void *, uint32_t)",
  close:
    "bool SteamAPI_ISteamNetworkingSockets_CloseConnection(void *, uint32_t, int, const char *, bool)",
  closeListen:
    "bool SteamAPI_ISteamNetworkingSockets_CloseListenSocket(void *, uint32_t)",
  info: "bool SteamAPI_ISteamNetworkingSockets_GetConnectionInfo(void *, uint32_t, void *)",
  send: "int SteamAPI_ISteamNetworkingSockets_SendMessageToConnection(void *, uint32_t, void *, uint32_t, int, void *)",
  receive:
    "int SteamAPI_ISteamNetworkingSockets_ReceiveMessagesOnConnection(void *, uint32_t, void *, int)",
  release: "void SteamAPI_SteamNetworkingMessage_t_Release(void *)",
  setIdentity:
    "void SteamAPI_SteamNetworkingIdentity_SetSteamID64(void *, uint64_t)",
  getIdentity: "uint64_t SteamAPI_SteamNetworkingIdentity_GetSteamID64(void *)",
};
// Steamworks ABI values this module mirrors. Callback structs use 8-byte packing on Windows
// and 4-byte packing elsewhere (VALVE_CALLBACK_PACK_LARGE / _SMALL), which moves 64-bit fields.
const WIN32_PACKING = process.platform === "win32";
// SteamNetConnectionStatusChangedCallback_t (k_iSteamNetworkingSocketsCallbacks + 1).
const CONNECTION_STATUS_CHANGED_CALLBACK = 1221;
// GameLobbyJoinRequested_t (k_iSteamFriendsCallbacks + 33): m_steamIDLobby, m_steamIDFriend.
const LOBBY_JOIN_REQUESTED_CALLBACK = 333;
const LOBBY_JOIN_REQUESTED_SIZE = 16;
// LobbyCreated_t (k_iSteamMatchmakingCallbacks + 13): EResult m_eResult, uint64 m_ulSteamIDLobby.
const LOBBY_CREATED_CALLBACK = 513;
const LOBBY_CREATED_SIZE = WIN32_PACKING ? 16 : 12;
const LOBBY_CREATED_LOBBY_OFFSET = WIN32_PACKING ? 8 : 4;
// LobbyEnter_t (k_iSteamMatchmakingCallbacks + 4): uint64 m_ulSteamIDLobby, uint32
// m_rgfChatPermissions, bool m_bLocked, uint32 m_EChatRoomEnterResponse.
const LOBBY_ENTER_CALLBACK = 504;
const LOBBY_ENTER_SIZE = WIN32_PACKING ? 24 : 20;
const LOBBY_ENTER_RESPONSE_OFFSET = 16;
// EChatRoomEnterResponse::k_EChatRoomEnterResponseSuccess.
const CHAT_ROOM_ENTER_SUCCESS = 1;
// ELobbyType::k_ELobbyTypeFriendsOnly, and the largest co-op match.
const LOBBY_TYPE_FRIENDS_ONLY = 1;
const MAX_LOBBY_MEMBERS = 4;
// EResult::k_EResultOK and k_EResultLimitExceeded (the send queue is full; retry later).
const RESULT_OK = 1;
const RESULT_LIMIT_EXCEEDED = 25;
// sizeof(SteamNetworkingIdentity).
const NETWORKING_IDENTITY_SIZE = 136;
// sizeof(SteamNetConnectionInfo_t), with offsets of m_hListenSocket and m_eState.
const CONNECTION_INFO_SIZE = 696;
const CONNECTION_INFO_LISTEN_SOCKET_OFFSET = 144;
const CONNECTION_INFO_STATE_OFFSET = 176;
// ESteamNetworkingConnectionState: None, Connecting and Connected; ClosedByPeer and
// ProblemDetectedLocally (and anything later) end the connection.
const CONNECTION_STATE_NONE = 0;
const CONNECTION_STATE_CONNECTING = 1;
const CONNECTION_STATE_CONNECTED = 3;
const CONNECTION_STATE_CLOSED_BY_PEER = 4;
// k_nSteamNetworkingSend_Reliable | k_nSteamNetworkingSend_NoNagle.
const SEND_RELIABLE_NO_NAGLE = 8 | 1;
// ESteamNetConnectionEnd::k_ESteamNetConnectionEnd_App_Generic.
const CONNECTION_END_APP = 1000;
// SteamNetworkingMessage_t: void *m_pData, then int m_cbSize; read 16 messages per pump.
const MESSAGE_PREFIX_SIZE = 16;
const MESSAGE_SIZE_OFFSET = 8;
const MESSAGES_PER_RECEIVE = 16;
// Lobby member data a player may set: the co-op selection they agreed to, so Ready clears
// itself whenever the host changes the scenario, difficulty or custom settings.
const MEMBER_KEYS = new Set(["ready"]);
const MEMBER_VALUE = /^[a-zA-Z0-9:|._-]{0,64}$/;
// The host's mirrored scenario selection; a complete custom game fits well within this.
const MAX_BROWSE_BYTES = 16 * 1024;

const MAX_BYTES = 16 * 1024 * 1024;
const MAX_COMPRESSED = 4 * 1024 * 1024;
const CHUNK = 32 * 1024;
const HEADER = 52;
const ID = /^[0-9]{17}$/;
const LOBBY_ID = /^[0-9]{17,20}$/;
function lobbyFromArgs(args) {
  const index = args.indexOf("+connect_lobby");
  const id = index < 0 ? "" : args[index + 1];
  return typeof id === "string" &&
    LOBBY_ID.test(id) &&
    BigInt(id) <= 18446744073709551615n
    ? id
    : undefined;
}
const RULES = /^[a-zA-Z0-9:._-]{1,128}$/;
const stringify = (value) =>
  JSON.stringify(value, (_key, item) =>
    typeof item === "number" && !Number.isFinite(item)
      ? { $electrifyNumber: String(item) }
      : item,
  );
const parse = (value) =>
  JSON.parse(value, (_key, item) =>
    item &&
    typeof item === "object" &&
    Object.keys(item).length === 1 &&
    ["Infinity", "-Infinity", "NaN"].includes(item.$electrifyNumber)
      ? Number(item.$electrifyNumber)
      : item,
  );
function loadMultiplayerFunctions(
  library = require("koffi").load(nativeLibraryPath()),
) {
  return Object.fromEntries(
    Object.entries(DECLARATIONS).map(([name, declaration]) => [
      name,
      library.func(declaration),
    ]),
  );
}
function encode(payload) {
  const json = stringify(payload);
  if (Buffer.byteLength(json) > MAX_BYTES)
    throw new Error("Co-op message is too large");
  const bytes = zlib.deflateRawSync(json);
  if (bytes.length > MAX_COMPRESSED)
    throw new Error("Co-op message is too large");
  return {
    bytes,
    hash: crypto.createHash("sha256").update(bytes).digest(),
    id: crypto.randomBytes(8),
    offset: 0,
  };
}
function chunk(message) {
  const index = message.offset;
  const count = Math.ceil(message.bytes.length / CHUNK);
  const result = Buffer.alloc(
    HEADER + Math.min(CHUNK, message.bytes.length - index * CHUNK),
  );
  result.write("ELM1");
  message.id.copy(result, 4);
  result.writeUInt16LE(index, 12);
  result.writeUInt16LE(count, 14);
  result.writeUInt32LE(message.bytes.length, 16);
  message.hash.copy(result, 20);
  message.bytes.copy(result, HEADER, index * CHUNK, (index + 1) * CHUNK);
  return result;
}
function assemble(incoming, bytes, now = Date.now()) {
  for (const [key, value] of incoming)
    if (now - value.created > 15000) incoming.delete(key);
  if (
    bytes.length < HEADER ||
    bytes.length > HEADER + CHUNK ||
    bytes.toString("ascii", 0, 4) !== "ELM1"
  )
    throw new Error("Invalid co-op frame");
  const key = bytes.subarray(4, 12).toString("hex"),
    index = bytes.readUInt16LE(12),
    count = bytes.readUInt16LE(14),
    length = bytes.readUInt32LE(16);
  if (
    !length ||
    length > MAX_COMPRESSED ||
    count !== Math.ceil(length / CHUNK) ||
    index >= count ||
    bytes.length !== HEADER + Math.min(CHUNK, length - index * CHUNK)
  )
    throw new Error("Invalid co-op frame bounds");
  const hash = bytes.subarray(20, HEADER).toString("hex");
  let transfer = incoming.get(key);
  if (!transfer) {
    if (incoming.size >= 4)
      throw new Error("Too many incomplete co-op messages");
    transfer = { created: now, count, length, hash, chunks: new Map() };
    incoming.set(key, transfer);
  }
  if (
    transfer.count !== count ||
    transfer.length !== length ||
    transfer.hash !== hash
  )
    throw new Error("Inconsistent co-op message");
  transfer.chunks.set(index, Buffer.from(bytes.subarray(HEADER)));
  if (transfer.chunks.size !== count) return;
  incoming.delete(key);
  const compressed = Buffer.concat(
    Array.from({ length: count }, (_, i) => transfer.chunks.get(i)),
  );
  if (crypto.createHash("sha256").update(compressed).digest("hex") !== hash)
    throw new Error("Co-op checksum failed");
  return parse(
    zlib
      .inflateRawSync(compressed, { maxOutputLength: MAX_BYTES })
      .toString("utf8"),
  );
}

class SteamMultiplayer {
  constructor(
    service,
    dispatcher,
    directory,
    emit,
    api = loadMultiplayerFunctions(),
    koffi = require("koffi"),
  ) {
    this.service = service;
    this.dispatcher = dispatcher;
    this.api = api;
    this.koffi = koffi;
    this.emit = emit;
    this.filename = path.join(directory, "co-op.json");
    this.matchmaking = api.matchmaking();
    this.sockets = api.sockets();
    this.utils = api.utils();
    if (!this.matchmaking || !this.sockets || !this.utils)
      throw new Error("Steam multiplayer interfaces unavailable");
    this.connections = new Map();
    this.allowed = null;
    this.savedAt = null;
    this.sharedAt = null;
    api.relay(this.utils);
    this.stopCallback = dispatcher.onCallback(
      CONNECTION_STATUS_CHANGED_CALLBACK,
      (bytes) => this.connectionChanged(bytes),
    );
    this.stopInvite = dispatcher.onCallback(
      LOBBY_JOIN_REQUESTED_CALLBACK,
      (bytes) => {
        if (bytes.length !== LOBBY_JOIN_REQUESTED_SIZE) return;
        this.pendingInvite = bytes.readBigUInt64LE(0).toString();
        this.emit({ kind: "invite", lobbyId: this.pendingInvite });
      },
    );
    this.pendingInvite = lobbyFromArgs(process.argv);
    this.timer = setInterval(() => {
      try {
        this.pump();
      } catch {
        this.fail("Steam connection interrupted. Reconnect to continue.");
      }
    }, 33);
    this.timer.unref();
    this.saveQueue = Promise.resolve();
  }
  state() {
    return {
      available: true,
      inviteLobbyId: this.pendingInvite,
      lobbyId: this.lobby?.toString(),
      hostId: this.hostId,
      selfId: this.service.identity.steamId,
      members: this.roster || [],
      connected: [...this.connections.values()]
        .filter((c) => c.connected)
        .map((c) => c.id),
      savedAt: this.savedAt,
      sharedAt: this.sharedAt,
      error: this.error,
    };
  }
  publish() {
    this.emit({ kind: "state", state: this.state() });
  }
  members() {
    if (!this.lobby) return [];
    const count = this.api.members(this.matchmaking, this.lobby);
    if (count < 1 || count > 4) throw new Error("Invalid lobby roster");
    return Array.from({ length: count }, (_, i) => {
      const id = this.api.member(this.matchmaking, this.lobby, i).toString();
      return {
        id,
        name:
          this.service.native.persona(
            this.service.native.friends(),
            BigInt(id),
          ) || "Player",
        ready:
          this.api.memberData(
            this.matchmaking,
            this.lobby,
            BigInt(id),
            "ready",
          ) || undefined,
      };
    });
  }
  async create(rules) {
    if (!RULES.test(rules)) throw new Error("Invalid game version");
    this.leave();
    const result = await this.dispatcher.callResult(
      this.api.create(
        this.matchmaking,
        LOBBY_TYPE_FRIENDS_ONLY,
        MAX_LOBBY_MEMBERS,
      ),
      { callback: LOBBY_CREATED_CALLBACK, size: LOBBY_CREATED_SIZE },
    );
    if (result.readInt32LE(0) !== RESULT_OK)
      throw new Error("Steam could not create the lobby");
    this.lobby = result.readBigUInt64LE(LOBBY_CREATED_LOBBY_OFFSET);
    this.hostId = this.service.identity.steamId;
    this.api.setData(this.matchmaking, this.lobby, "electrify", "realtime-v1");
    this.api.setData(this.matchmaking, this.lobby, "rules", rules);
    this.api.setData(this.matchmaking, this.lobby, "host", this.hostId);
    this.listener = this.api.listen(this.sockets, 0, 0, null);
    if (!this.listener) {
      this.leave();
      throw new Error("Steam could not open the game connection");
    }
    this.error = undefined;
    this.refresh();
    return this.state();
  }
  async join(id, rules) {
    if (
      !LOBBY_ID.test(id) ||
      BigInt(id) > 18446744073709551615n ||
      !RULES.test(rules)
    )
      throw new Error("Enter a valid lobby code");
    this.leave();
    const lobby = BigInt(id);
    const result = await this.dispatcher.callResult(
      this.api.join(this.matchmaking, lobby),
      { callback: LOBBY_ENTER_CALLBACK, size: LOBBY_ENTER_SIZE },
    );
    if (
      result.readUInt32LE(LOBBY_ENTER_RESPONSE_OFFSET) !==
        CHAT_ROOM_ENTER_SUCCESS ||
      result.readBigUInt64LE(0) !== lobby
    ) {
      this.api.leave(this.matchmaking, lobby);
      throw new Error("Steam could not join this lobby");
    }
    this.lobby = lobby;
    this.hostId = this.api.data(this.matchmaking, lobby, "host");
    if (
      this.api.data(this.matchmaking, lobby, "electrify") !== "realtime-v1" ||
      this.api.data(this.matchmaking, lobby, "rules") !== rules ||
      !ID.test(this.hostId) ||
      this.api.owner(this.matchmaking, lobby).toString() !== this.hostId
    ) {
      this.leave();
      throw new Error(
        "This lobby uses another game build or its host has left",
      );
    }
    this.error = undefined;
    this.refresh();
    this.connectHost();
    return this.state();
  }
  connectHost() {
    if (
      !this.lobby ||
      this.hostId === this.service.identity.steamId ||
      [...this.connections.values()].some((c) => c.id === this.hostId)
    )
      return;
    const identity = Buffer.alloc(NETWORKING_IDENTITY_SIZE);
    this.api.setIdentity(identity, BigInt(this.hostId));
    const handle = this.api.connect(this.sockets, identity, 0, 0, null);
    if (!handle) throw new Error("Steam could not connect to the host");
    this.connections.set(handle, {
      id: this.hostId,
      connected: false,
      queue: [],
      incoming: new Map(),
    });
  }
  connectionChanged(bytes) {
    if (bytes.length < 4) return;
    const handle = bytes.readUInt32LE(0),
      info = Buffer.alloc(CONNECTION_INFO_SIZE);
    if (!this.api.info(this.sockets, handle, info)) return;
    const id = this.api.getIdentity(info).toString(),
      state = info.readInt32LE(CONNECTION_INFO_STATE_OFFSET);
    // A connection arriving on this host's listen socket.
    if (
      state === CONNECTION_STATE_CONNECTING &&
      info.readUInt32LE(CONNECTION_INFO_LISTEN_SOCKET_OFFSET)
    ) {
      const members = this.members();
      if (
        this.hostId !== this.service.identity.steamId ||
        !members.some((m) => m.id === id) ||
        (this.allowed && !this.allowed.has(id))
      ) {
        this.api.close(
          this.sockets,
          handle,
          CONNECTION_END_APP,
          "Not in this match",
          false,
        );
        return;
      }
      // A reconnecting player can arrive before the host notices its old connection died.
      // Steam authenticated this identity, so the new connection replaces the stale one.
      for (const [previous, connection] of [...this.connections])
        if (connection.id === id) this.drop(previous);
      this.connections.set(handle, {
        id,
        connected: false,
        queue: [],
        incoming: new Map(),
      });
      if (this.api.accept(this.sockets, handle) !== RESULT_OK)
        this.drop(handle);
    } else if (state === CONNECTION_STATE_CONNECTED) {
      const connection = this.connections.get(handle);
      if (connection) {
        connection.connected = true;
        connection.lastHeartbeat = performance.now();
        this.publish();
      }
    } else if (
      state >= CONNECTION_STATE_CLOSED_BY_PEER ||
      state === CONNECTION_STATE_NONE
    )
      this.drop(handle);
  }
  drop(handle) {
    const connection = this.connections.get(handle);
    this.api.close(
      this.sockets,
      handle,
      CONNECTION_END_APP,
      "Disconnected",
      false,
    );
    this.connections.delete(handle);
    if (connection) {
      this.emit({ kind: "disconnected", sender: connection.id });
      this.publish();
    }
  }
  send(to, payload, encoded) {
    const connection = [...this.connections.values()].find(
      (c) => c.id === to && c.connected,
    );
    if (
      !connection ||
      (this.hostId !== this.service.identity.steamId && to !== this.hostId)
    )
      throw new Error("Player is disconnected");
    // Each connection tracks its own progress through bytes that may be shared with others.
    const message = {
      ...(encoded || encode(payload)),
      offset: 0,
      kind: payload?.kind,
    };
    // Views are self-contained: keep the latest unsent view, never an unbounded tick backlog.
    if (message.kind === "view")
      connection.queue = connection.queue.filter(
        (m) => m.kind !== "view" || m.offset > 0,
      );
    if (connection.queue.length >= 64)
      throw new Error("Co-op connection is catching up");
    connection.queue.push(message);
  }
  refresh() {
    if (!this.lobby) return;
    this.roster = this.members();
    if (
      this.api.owner(this.matchmaking, this.lobby).toString() !== this.hostId
    ) {
      this.fail("The host left. Resume a shared save in a new lobby.");
      return;
    }
    this.publish();
  }
  async persist(world) {
    if (
      !world ||
      world.schema !== 1 ||
      !Array.isArray(world.seats) ||
      world.seats.length < 2 ||
      world.seats.length > 4 ||
      !world.seats.some((s) => s.id === this.service.identity.steamId)
    )
      throw new Error("Invalid shared save");
    const json = stringify(world);
    if (Buffer.byteLength(json) > MAX_BYTES)
      throw new Error("Shared save is too large");
    const digest = crypto.createHash("sha256").update(json).digest("hex");
    this.saveQueue = this.saveQueue
      .catch(() => {})
      .then(() => atomicWriteAsync(this.filename, json));
    await this.saveQueue;
    this.savedAt = Date.now();
    this.publish();
    return digest;
  }
  async checkpoint(world) {
    if (this.hostId !== this.service.identity.steamId)
      throw new Error("Only the host can save the world");
    const digest = await this.persist(world);
    this.checkpointHash = digest;
    this.checkpointAt = this.savedAt;
    // The local save already succeeded. A guest that cannot take this copy receives the next
    // one; that must not turn the host's save, or the desktop quit handshake, into a failure.
    const payload = { kind: "checkpoint", world, digest };
    const encoded = encode(payload);
    for (const c of this.connections.values())
      if (c.connected)
        try {
          this.send(c.id, payload, encoded);
        } catch {
          // Retried by the next periodic checkpoint.
        }
    return this.state();
  }
  async receive(sender, payload) {
    if (payload?.kind === "heartbeat") {
      const connection = [...this.connections.values()].find(
        (c) => c.id === sender,
      );
      if (connection) connection.lastHeartbeat = performance.now();
      return;
    }
    if (!payload || typeof payload !== "object")
      throw new Error("Invalid message");
    if (payload.kind === "checkpoint") {
      if (
        sender !== this.hostId ||
        this.hostId === this.service.identity.steamId
      )
        throw new Error("Invalid save sender");
      const digest = await this.persist(payload.world);
      if (digest !== payload.digest)
        throw new Error("Shared save checksum failed");
      // The host persists before sending; this complete local write establishes two copies.
      this.sharedAt = this.savedAt;
      this.publish();
      this.send(sender, { kind: "saved", digest });
      return;
    }
    if (
      payload.kind === "saved" &&
      this.hostId === this.service.identity.steamId
    ) {
      // A guest can still be acknowledging the previous checkpoint when the next one starts.
      // That acknowledgement is stale, not hostile, so it must not drop the connection.
      if (payload.digest === this.checkpointHash) {
        this.sharedAt = this.checkpointAt;
        this.publish();
      }
      return;
    }
    if (sender !== this.hostId && this.hostId !== this.service.identity.steamId)
      throw new Error("Invalid message sender");
    if (
      this.hostId === this.service.identity.steamId &&
      payload.kind !== "command" &&
      payload.kind !== "save-request"
    )
      throw new Error("Invalid guest message");
    if (
      ["save-request", "save-result"].includes(payload.kind) &&
      (typeof payload.requestId !== "string" || payload.requestId.length > 64)
    )
      throw new Error("Invalid save request");
    if (
      payload.kind === "browse" &&
      (!payload.browse ||
        Buffer.byteLength(JSON.stringify(payload.browse)) > MAX_BROWSE_BYTES)
    )
      throw new Error("Invalid scenario selection");
    if (payload.kind === "command") {
      const envelope = payload.envelope;
      if (
        !envelope ||
        typeof envelope.matchId !== "string" ||
        envelope.matchId.length > 64 ||
        typeof envelope.epoch !== "string" ||
        envelope.epoch.length > 64 ||
        !Number.isSafeInteger(envelope.sequence) ||
        envelope.sequence < 1 ||
        !envelope.command ||
        typeof envelope.command.kind !== "string" ||
        Buffer.byteLength(JSON.stringify(envelope)) > 2048
      )
        throw new Error("Invalid command envelope");
    }
    this.emit({ kind: "message", sender, payload });
  }
  pump() {
    if (!this.lobby) return;
    if (!this.lastRefresh || Date.now() - this.lastRefresh >= 1000) {
      this.lastRefresh = Date.now();
      this.refresh();
    }
    for (const [handle, c] of this.connections) {
      if (!c.connected) continue;
      if (
        this.hostId === this.service.identity.steamId &&
        performance.now() - c.lastHeartbeat > 5000
      ) {
        this.drop(handle);
        continue;
      }
      const outgoing = c.queue[0];
      if (outgoing) {
        const frame = chunk(outgoing),
          result = this.api.send(
            this.sockets,
            handle,
            frame,
            frame.length,
            SEND_RELIABLE_NO_NAGLE,
            null,
          );
        if (result === RESULT_OK) {
          outgoing.offset++;
          if (outgoing.offset * CHUNK >= outgoing.bytes.length) c.queue.shift();
        } else if (result !== RESULT_LIMIT_EXCEEDED) {
          this.drop(handle);
          continue;
        }
      }
      const pointers = Buffer.alloc(8 * MESSAGES_PER_RECEIVE),
        count = this.api.receive(
          this.sockets,
          handle,
          pointers,
          MESSAGES_PER_RECEIVE,
        );
      if (count < 0) {
        this.drop(handle);
        continue;
      }
      for (let i = 0; i < count; i++) {
        const pointer = pointers.readBigUInt64LE(i * 8);
        try {
          const prefix = Buffer.from(
            this.koffi.decode(pointer, "uint8_t", MESSAGE_PREFIX_SIZE),
          );
          const length = prefix.readInt32LE(MESSAGE_SIZE_OFFSET);
          if (length < HEADER || length > HEADER + CHUNK)
            throw new Error("Invalid frame size");
          const bytes = Buffer.from(
            this.koffi.decode(prefix.readBigUInt64LE(0), "uint8_t", length),
          );
          const payload = assemble(c.incoming, bytes);
          if (payload)
            void this.receive(c.id, payload).catch(() => this.drop(handle));
        } catch {
          this.drop(handle);
        } finally {
          this.api.release(pointer);
        }
      }
    }
  }
  fail(error) {
    this.error = error;
    this.emit({ kind: "disconnected", sender: this.hostId });
    this.publish();
  }
  leave() {
    for (const handle of [...this.connections.keys()]) this.drop(handle);
    if (this.listener) this.api.closeListen(this.sockets, this.listener);
    if (this.lobby) this.api.leave(this.matchmaking, this.lobby);
    this.lobby = undefined;
    this.listener = undefined;
    this.hostId = undefined;
    this.roster = [];
    this.allowed = null;
    this.error = undefined;
    this.sharedAt = null;
    this.pendingInvite = undefined;
    this.publish();
  }
  async request(input) {
    if (!input || typeof input !== "object")
      throw new Error("Invalid multiplayer request");
    // Answering an invitation consumes it even when joining fails, so the title screen does not
    // reopen the same invitation every time it mounts.
    if (input.kind === "join") this.pendingInvite = undefined;
    if (["create", "join"].includes(input.kind) && !this.service.state().online)
      throw new Error("Connect to Steam to join a match");
    switch (input.kind) {
      case "state":
        return this.state();
      case "create":
        return this.create(input.rules);
      case "join":
        return this.join(input.lobbyId, input.rules);
      case "leave":
        this.leave();
        return this.state();
      case "reconnect":
        if (this.hostId !== this.service.identity.steamId)
          for (const handle of [...this.connections.keys()]) this.drop(handle);
        this.error = undefined;
        this.refresh();
        this.connectHost();
        return this.state();
      case "member":
        if (
          !this.lobby ||
          !MEMBER_KEYS.has(input.key) ||
          typeof input.value !== "string" ||
          !MEMBER_VALUE.test(input.value)
        )
          throw new Error("Invalid lobby member data");
        this.api.setMemberData(
          this.matchmaking,
          this.lobby,
          input.key,
          input.value,
        );
        this.refresh();
        return this.state();
      case "unlock":
        // Back in the lobby after a match: anyone in the lobby may join the next one.
        if (this.hostId !== this.service.identity.steamId)
          throw new Error("Only the host can reopen the lobby");
        this.allowed = null;
        return this.state();
      case "invite":
        if (this.lobby)
          this.api.invite(this.service.native.friends(), this.lobby);
        return;
      case "lock":
        if (
          this.hostId !== this.service.identity.steamId ||
          !Array.isArray(input.ids) ||
          input.ids.length < 2 ||
          input.ids.length > 4 ||
          input.ids.some((id) => !ID.test(id))
        )
          throw new Error("Invalid match roster");
        this.allowed = new Set(input.ids);
        return;
      case "send":
        return this.send(input.to, input.payload);
      case "checkpoint":
        return this.checkpoint(input.world);
      case "read-checkpoint": {
        const value = readJson(this.filename, null);
        return value === null ? null : parse(JSON.stringify(value));
      }
      default:
        throw new Error("Unknown multiplayer request");
    }
  }
  dispose() {
    clearInterval(this.timer);
    this.stopCallback();
    this.stopInvite();
    this.leave();
  }
}
module.exports = {
  SteamMultiplayer,
  loadMultiplayerFunctions,
  DECLARATIONS,
  encode,
  chunk,
  assemble,
  stringify,
  parse,
  lobbyFromArgs,
};
