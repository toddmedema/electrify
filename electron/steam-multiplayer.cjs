const crypto = require("node:crypto");
const zlib = require("node:zlib");
const { nativeLibraryPath } = require("./steam-native.cjs");
const { CoopSaveStore } = require("./coop-storage.cjs");
const { stringify, parse } = require("./coop-codec.cjs");
const {
  isRuleJson,
  RULE_LIMITS,
} = require("../src/helpers/ScenarioRulesSchema.js");

// Valve flat API, the SDK bundled with steamworks.js. No second callback consumer.
const DECLARATIONS = {
  matchmaking: "void * SteamAPI_SteamMatchmaking_v009()",
  sockets: "void * SteamAPI_SteamNetworkingSockets_SteamAPI_v012()",
  utils: "void * SteamAPI_SteamNetworkingUtils_SteamAPI_v004()",
  relay: "void SteamAPI_ISteamNetworkingUtils_InitRelayNetworkAccess(void *)",
  create: "uint64_t SteamAPI_ISteamMatchmaking_CreateLobby(void *, int, int)",
  join: "uint64_t SteamAPI_ISteamMatchmaking_JoinLobby(void *, uint64_t)",
  list: "uint64_t SteamAPI_ISteamMatchmaking_RequestLobbyList(void *)",
  stringFilter:
    "void SteamAPI_ISteamMatchmaking_AddRequestLobbyListStringFilter(void *, const char *, const char *, int)",
  distanceFilter:
    "void SteamAPI_ISteamMatchmaking_AddRequestLobbyListDistanceFilter(void *, int)",
  resultLimit:
    "void SteamAPI_ISteamMatchmaking_AddRequestLobbyListResultCountFilter(void *, int)",
  lobbyByIndex:
    "uint64_t SteamAPI_ISteamMatchmaking_GetLobbyByIndex(void *, int)",
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
// Invisible lobbies support code lookup without appearing in friends' lobby lists.
// Friends-only lobbies cannot be returned by RequestLobbyList.
const LOBBY_TYPE_INVISIBLE = 3;
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
// itself whenever the host changes the scenario, difficulty or custom settings, and the saved
// company they claimed while resuming a multiplayer save.
const MEMBER_KEYS = new Set(["ready", "slot"]);
const MEMBER_VALUE = /^[a-zA-Z0-9:|._-]{0,256}$/;
// The host's mirrored scenario selection; a complete custom game fits well within this.
const MAX_BROWSE_BYTES = 16 * 1024;
const MAX_CAMPAIGN_BYTES = 4 * 1024;
const MAX_SCENARIO_BYTES = RULE_LIMITS.compiledBytes;
const MAX_SCENARIO_ENVELOPE_BYTES = 1024;
const SCENARIO_SELECTION = /^[a-zA-Z0-9:|._-]{1,256}$/;

const MAX_BYTES = 16 * 1024 * 1024;
const MAX_COMPRESSED = 4 * 1024 * 1024;
const MAX_PENDING_CHECKPOINTS = 2;
const MAX_RECORD_BYTES = 64 * 1024;
const MAX_RECORDS = 256;
const CHUNK = 32 * 1024;
const HEADER = 52;
const MESSAGE_KINDS = new Set([
  "heartbeat",
  "checkpoint",
  "saved",
  "command",
  "save-request",
  "save-result",
  "browse",
  "campaign",
  "keepalive",
  "scenario",
  "records",
  "baseline",
  "rejected",
  "progress",
  "resync",
]);
const REPLICATION_HOST_KINDS = new Set(["records", "baseline", "rejected"]);
const REPLICATION_GUEST_KINDS = new Set(["progress", "resync"]);
const MESSAGE_MAGIC = "ELM2";
const SCENARIO_MAGIC = "ELS1";
const ID = /^[0-9]{17}$/;
const LOBBY_ID = /^[0-9]{17,20}$/;
const INVITE_CODE = /^[0-9]{6}$/;
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
function messageJSON(payload) {
  if (!payload || !MESSAGE_KINDS.has(payload.kind))
    throw new Error("Invalid co-op message kind");
  if (payload.kind === "scenario") validScenarioMessage(payload);
  validReplicationMessage(payload);
  // The kind is always the first, literal key. The receiver checks it on the first
  // decompressed chunk, before allowing the larger world-message budget.
  const { kind, ...body } = payload;
  const json = stringify(
    kind === "scenario"
      ? { kind, selectionKey: payload.selectionKey, scenario: payload.scenario }
      : { kind, ...body },
  );
  if (Buffer.byteLength(json) > MAX_BYTES)
    throw new Error("Co-op message is too large");
  return json;
}
function encodedMessage(bytes, kind) {
  if (bytes.length > MAX_COMPRESSED)
    throw new Error("Co-op message is too large");
  return {
    bytes,
    hash: crypto.createHash("sha256").update(bytes).digest(),
    id: crypto.randomBytes(8),
    offset: 0,
    magic: kind === "scenario" ? SCENARIO_MAGIC : MESSAGE_MAGIC,
  };
}
function encode(payload) {
  return encodedMessage(
    zlib.deflateRawSync(messageJSON(payload)),
    payload.kind,
  );
}
/** Large worlds must leave Steam's callback/IPC pump free to accept control messages. */
function encodeAsync(payload) {
  return new Promise((resolve, reject) => {
    const json = messageJSON(payload);
    zlib.deflateRaw(json, (error, bytes) => {
      if (error) return reject(error);
      try {
        resolve(encodedMessage(bytes, payload.kind));
      } catch (error) {
        reject(error);
      }
    });
  });
}
function chunk(message) {
  const index = message.offset;
  const count = Math.ceil(message.bytes.length / CHUNK);
  const result = Buffer.alloc(
    HEADER + Math.min(CHUNK, message.bytes.length - index * CHUNK),
  );
  result.write(message.magic);
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
    if (now - value.created > 15000) {
      value.inflater?.destroy(new Error("Co-op message expired"));
      incoming.delete(key);
    }
  const magic = bytes.toString("latin1", 0, 4);
  if (
    bytes.length < HEADER ||
    bytes.length > HEADER + CHUNK ||
    ![MESSAGE_MAGIC, SCENARIO_MAGIC].includes(magic)
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
    transfer = { created: now, count, length, hash, magic, chunks: new Map() };
    incoming.set(key, transfer);
  }
  if (
    transfer.count !== count ||
    transfer.length !== length ||
    transfer.hash !== hash ||
    transfer.magic !== magic ||
    transfer.inflater
  )
    throw new Error("Inconsistent co-op message");
  transfer.chunks.set(index, Buffer.from(bytes.subarray(HEADER)));
  if (transfer.chunks.size !== count) return;
  const compressed = Buffer.concat(
    Array.from({ length: count }, (_, i) => transfer.chunks.get(i)),
  );
  if (crypto.createHash("sha256").update(compressed).digest("hex") !== hash) {
    incoming.delete(key);
    throw new Error("Co-op checksum failed");
  }
  // Keep active inflaters in the same four-transfer budget as unfinished chunks.
  // Unlike a synchronous 16MiB inflate followed by a kind check, streaming stops a
  // snapshot bomb while decompressing and rejects a relabelled generic frame early.
  return inflateMessage(compressed, transfer).finally(() => {
    if (incoming.get(key) === transfer) incoming.delete(key);
  });
}

function validScenarioMessage(payload) {
  if (
    !isRuleJson(payload) ||
    Object.keys(payload).length !== 3 ||
    payload.kind !== "scenario" ||
    typeof payload.selectionKey !== "string" ||
    !SCENARIO_SELECTION.test(payload.selectionKey) ||
    !payload.scenario ||
    typeof payload.scenario !== "object" ||
    Array.isArray(payload.scenario)
  )
    throw new Error("Invalid co-op scenario message");
  const scenarioBytes = Buffer.byteLength(JSON.stringify(payload.scenario));
  const messageBytes = Buffer.byteLength(JSON.stringify(payload));
  if (scenarioBytes > MAX_SCENARIO_BYTES)
    throw new Error("Co-op scenario is too large");
  if (messageBytes - scenarioBytes > MAX_SCENARIO_ENVELOPE_BYTES)
    throw new Error("Co-op scenario envelope is too large");
}

const boundedText = (value, maximum = 64) =>
  typeof value === "string" && value.length > 0 && value.length <= maximum;
const indexValue = (value) => Number.isSafeInteger(value) && value >= 0;
const reasonsValue = (value) =>
  Array.isArray(value) &&
  value.length <= 64 &&
  Array.from(value).every((s) => boundedText(s, 2048));
function validEnvelope(envelope) {
  return (
    envelope &&
    boundedText(envelope.matchId) &&
    boundedText(envelope.epoch) &&
    Number.isSafeInteger(envelope.sequence) &&
    envelope.sequence >= 1 &&
    envelope.command &&
    boundedText(envelope.command.kind) &&
    Buffer.byteLength(stringify(envelope)) <= 2048
  );
}
function validRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record))
    return false;
  switch (record.t) {
    case "command":
      return (
        boundedText(record.seat) &&
        validEnvelope(record.envelope) &&
        typeof record.allowReady === "boolean" &&
        (record.error === undefined || boundedText(record.error, 2048)) &&
        indexValue(record.revision)
      );
    case "step":
      return (
        Number.isSafeInteger(record.n) &&
        record.n >= 1 &&
        record.n <= 10000 &&
        indexValue(record.revision)
      );
    case "pause":
      return boundedText(record.reason, 2048);
    case "blockers":
      return reasonsValue(record.reasons);
    case "verify":
      return true;
    case "fault":
      return boundedText(record.message, 2048);
    default:
      return false;
  }
}
/** The worker owns semantic world validation; native code bounds and authenticates the wire. */
function validReplicationMessage(payload) {
  const { kind } = payload;
  if (
    kind === "keepalive" &&
    payload.disconnected !== undefined &&
    (!Array.isArray(payload.disconnected) ||
      payload.disconnected.length > 4 ||
      !Array.from(payload.disconnected).every(
        (id) => typeof id === "string" && ID.test(id),
      ))
  )
    throw new Error("Invalid disconnected seats");
  if (!REPLICATION_HOST_KINDS.has(kind) && !REPLICATION_GUEST_KINDS.has(kind))
    return;
  let valid = boundedText(payload.matchId) && boundedText(payload.epoch);
  if (REPLICATION_GUEST_KINDS.has(kind) || kind === "rejected")
    valid &&= Buffer.byteLength(stringify(payload)) <= 4096;
  if (kind === "records") {
    valid &&=
      Number.isSafeInteger(payload.from) &&
      payload.from >= 1 &&
      Array.isArray(payload.records) &&
      payload.records.length >= 1 &&
      payload.records.length <= MAX_RECORDS &&
      Array.from(payload.records).every(validRecord) &&
      Number.isSafeInteger(payload.from + payload.records.length - 1) &&
      Buffer.byteLength(stringify(payload)) <= MAX_RECORD_BYTES;
  } else if (kind === "baseline") {
    valid &&=
      indexValue(payload.index) &&
      reasonsValue(payload.blockers) &&
      payload.world &&
      typeof payload.world === "object" &&
      !Array.isArray(payload.world) &&
      payload.world.matchId === payload.matchId &&
      payload.world.epoch === payload.epoch &&
      Buffer.byteLength(stringify(payload)) <= MAX_BYTES;
  } else if (kind === "rejected") {
    valid &&=
      Number.isSafeInteger(payload.sequence) &&
      payload.sequence >= 1 &&
      boundedText(payload.error, 2048);
  } else if (kind === "progress") {
    valid &&=
      indexValue(payload.applied) &&
      (payload.verified === undefined ||
        (payload.verified &&
          indexValue(payload.verified.index) &&
          payload.verified.index <= payload.applied &&
          typeof payload.verified.hash === "string" &&
          /^[a-f0-9]{64}$/.test(payload.verified.hash)));
  } else if (kind === "resync") {
    valid &&= indexValue(payload.applied) && boundedText(payload.reason, 2048);
  }
  if (!valid) throw new Error(`Invalid co-op ${kind} message`);
}

function inflateMessage(compressed, transfer) {
  const scenario = transfer.magic === SCENARIO_MAGIC;
  let limit = scenario
    ? MAX_SCENARIO_BYTES + MAX_SCENARIO_ENVELOPE_BYTES
    : MAX_BYTES;
  return new Promise((resolve, reject) => {
    const inflater = zlib.createInflateRaw({ chunkSize: 16 * 1024 });
    transfer.inflater = inflater;
    const chunks = [];
    let length = 0,
      prefix = "",
      scenarioPrefix,
      kind;
    inflater.on("error", reject);
    inflater.on("data", (part) => {
      length += part.length;
      if (!kind || (scenario && !scenarioPrefix)) {
        prefix += part
          .subarray(0, Math.max(0, (scenario ? 512 : 64) - prefix.length))
          .toString("latin1");
        const match = /^\{"kind":"([a-z-]{1,32})"(?=[,}])/.exec(prefix);
        if (match) {
          kind = match[1];
          if (kind === "records") limit = MAX_RECORD_BYTES;
          if (REPLICATION_GUEST_KINDS.has(kind) || kind === "rejected")
            limit = 4096;
          if (!MESSAGE_KINDS.has(kind) || (kind === "scenario") !== scenario) {
            inflater.destroy(
              new Error("Co-op frame kind does not match its message"),
            );
            return;
          }
        } else if (prefix.length >= 64) {
          inflater.destroy(new Error("Invalid co-op frame kind prefix"));
          return;
        }
        if (scenario) {
          scenarioPrefix =
            /^\{"kind":"scenario","selectionKey":"[a-zA-Z0-9:|._-]{1,256}","scenario":/.exec(
              prefix,
            );
          if (scenarioPrefix) {
            // This canonical envelope has one closing brace after the scenario.
            // Deriving its exact size keeps even a one-byte snapshot overrun from
            // being hidden in the reserved envelope allowance until JSON parsing.
            limit = scenarioPrefix[0].length + MAX_SCENARIO_BYTES + 1;
          } else if (prefix.length >= 512) {
            inflater.destroy(
              new Error("Invalid co-op scenario envelope prefix"),
            );
            return;
          }
        }
      }
      if (length > limit) {
        inflater.destroy(new Error("Co-op decompression limit exceeded"));
        return;
      }
      chunks.push(part);
    });
    inflater.on("end", () => {
      try {
        const json = new TextDecoder("utf-8", { fatal: true }).decode(
          Buffer.concat(chunks, length),
        );
        const payload = scenario ? JSON.parse(json) : parse(json);
        if (!kind || payload?.kind !== kind || (scenario && !scenarioPrefix))
          throw new Error("Co-op frame kind does not match its message");
        if (scenario) validScenarioMessage(payload);
        validReplicationMessage(payload);
        resolve(payload);
      } catch (error) {
        reject(error);
      }
    });
    inflater.end(compressed);
  });
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
    this.saves = new CoopSaveStore(directory, service, { stringify, parse });
    this.matchmaking = api.matchmaking();
    this.sockets = api.sockets();
    this.utils = api.utils();
    if (!this.matchmaking || !this.sockets || !this.utils)
      throw new Error("Steam multiplayer interfaces unavailable");
    this.connections = new Map();
    this.pendingCheckpoints = new Map();
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
  }
  state() {
    return {
      available: true,
      inviteLobbyId: this.pendingInvite,
      lobbyId: this.lobby?.toString(),
      inviteCode: this.inviteCode,
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
        slot:
          this.api.memberData(
            this.matchmaking,
            this.lobby,
            BigInt(id),
            "slot",
          ) || undefined,
      };
    });
  }
  async findCode(code) {
    // ELobbyComparisonEqual = 0; worldwide distance = 3. Two results let us
    // reject a collision instead of silently connecting to the wrong friend's game.
    this.api.stringFilter(this.matchmaking, "electrify", "realtime-v1", 0);
    this.api.stringFilter(this.matchmaking, "invite-code", code, 0);
    this.api.distanceFilter(this.matchmaking, 3);
    this.api.resultLimit(this.matchmaking, 2);
    const result = await this.dispatcher.callResult(
      this.api.list(this.matchmaking),
      { callback: 510, size: 4 }, // LobbyMatchList_t: uint32 m_nLobbiesMatching
    );
    return Array.from({ length: Math.min(2, result.readUInt32LE(0)) }, (_, i) =>
      this.api.lobbyByIndex(this.matchmaking, i),
    );
  }
  async create(rules) {
    if (!RULES.test(rules)) throw new Error("Invalid game version");
    this.leave();
    let code;
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = crypto.randomInt(1000000).toString().padStart(6, "0");
      if (!(await this.findCode(candidate)).length) {
        code = candidate;
        break;
      }
    }
    if (!code)
      throw new Error("Steam could not allocate an invite code. Try again.");
    const result = await this.dispatcher.callResult(
      this.api.create(
        this.matchmaking,
        LOBBY_TYPE_INVISIBLE,
        MAX_LOBBY_MEMBERS,
      ),
      { callback: LOBBY_CREATED_CALLBACK, size: LOBBY_CREATED_SIZE },
    );
    if (result.readInt32LE(0) !== RESULT_OK)
      throw new Error("Steam could not create the lobby");
    this.lobby = result.readBigUInt64LE(LOBBY_CREATED_LOBBY_OFFSET);
    this.hostId = this.service.identity.steamId;
    for (const [key, value] of Object.entries({
      electrify: "realtime-v1",
      rules,
      host: this.hostId,
      "invite-code": code,
    })) {
      if (!this.api.setData(this.matchmaking, this.lobby, key, value)) {
        this.leave();
        throw new Error("Steam could not publish the invite code. Try again.");
      }
    }
    this.inviteCode = code;
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
      typeof id !== "string" ||
      !(INVITE_CODE.test(id) || LOBBY_ID.test(id)) ||
      BigInt(id) > 18446744073709551615n ||
      !RULES.test(rules)
    )
      throw new Error("Enter a valid lobby code");
    this.leave();
    if (INVITE_CODE.test(id)) {
      const matches = await this.findCode(id);
      if (matches.length !== 1)
        throw new Error(
          matches.length
            ? "This invite code is ambiguous. Ask your friend to host again."
            : "No game found. Check the six-digit code and ask your friend to keep the lobby open.",
        );
      id = matches[0].toString();
    }
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
    const code = this.api.data(this.matchmaking, lobby, "invite-code");
    this.inviteCode = INVITE_CODE.test(code) ? code : undefined;
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
    for (const transfer of connection?.incoming?.values() ?? [])
      transfer.inflater?.destroy(new Error("Co-op connection closed"));
    connection?.incoming?.clear();
    if (connection) connection.pendingFrames = [];
    this.api.close(
      this.sockets,
      handle,
      CONNECTION_END_APP,
      "Disconnected",
      false,
    );
    this.connections.delete(handle);
    if (connection) {
      for (const [matchId, request] of this.pendingCheckpoints)
        if (request.connection === connection)
          this.pendingCheckpoints.delete(matchId);
      this.emit({ kind: "disconnected", sender: connection.id });
      this.publish();
    }
  }
  send(to, payload, encoded) {
    if (!MESSAGE_KINDS.has(payload?.kind))
      throw new Error("Invalid co-op message kind");
    const connection = [...this.connections.values()].find(
      (c) => c.id === to && c.connected,
    );
    if (
      !connection ||
      (this.hostId !== this.service.identity.steamId && to !== this.hostId)
    )
      throw new Error("Player is disconnected");
    if (REPLICATION_HOST_KINDS.has(payload?.kind) && !encoded)
      return this.sendOrdered(connection, payload);
    // Each connection tracks its own progress through bytes that may be shared with others.
    const message = {
      ...(encoded || encode(payload)),
      offset: 0,
      kind: payload?.kind,
    };
    if (
      (message.kind === "browse" && payload.browse?.phase === "browsing") ||
      message.kind === "campaign" ||
      message.kind === "scenario"
    ) {
      // Lobby/definition changes must not be followed by a late encode of the old game.
      connection.transportGeneration =
        (connection.transportGeneration || 0) + 1;
    }
    const matchId = payload.world?.matchId;
    const digest = payload.digest;
    if (
      message.kind === "checkpoint" &&
      typeof matchId === "string" &&
      typeof digest === "string"
    ) {
      message.matchId = matchId;
      message.digest = digest;
      const queue = connection.checkpointQueue;
      const latestIndex =
        queue?.findLastIndex((queued) => queued.matchId === matchId) ?? -1;
      const latest = queue?.[latestIndex];
      if (latest?.digest === digest) return;
      // Other campaigns have their own save slots and keep their place in the queue.
      if (latest?.offset === 0) {
        const active = queue[0];
        // We can return to the save whose first frames are already on the wire.
        if (
          active.matchId === matchId &&
          active.digest === digest &&
          active.offset > 0
        )
          queue.splice(latestIndex, 1);
        else queue[latestIndex] = message;
        return;
      }
    }
    if (
      connection.queue.length + (connection.checkpointQueue?.length || 0) >=
      64
    )
      throw new Error("Co-op connection is catching up");
    const queue =
      message.kind === "checkpoint"
        ? (connection.checkpointQueue ||= [])
        : connection.queue;
    queue.push(message);
  }
  encodeBaseline(payload) {
    return encodeAsync(payload);
  }
  /** A baseline's asynchronous encoding may never be overtaken by subsequent records. */
  sendOrdered(connection, payload) {
    if (
      connection.queue.length +
        (connection.checkpointQueue?.length || 0) +
        (connection.encodingCount || 0) >=
      64
    )
      throw new Error("Co-op connection is catching up");
    validReplicationMessage(payload);
    const generation = connection.transportGeneration || 0;
    connection.encodingCount = (connection.encodingCount || 0) + 1;
    const result = (connection.encodeChain || Promise.resolve())
      .then(async () => {
        const current = () =>
          connection.connected &&
          [...this.connections.values()].includes(connection) &&
          generation === (connection.transportGeneration || 0);
        if (!current()) throw new Error("Player is disconnected");
        const encoded =
          payload.kind === "baseline"
            ? await this.encodeBaseline(payload)
            : encode(payload);
        if (!current()) throw new Error("Player is disconnected");
        this.send(connection.id, payload, encoded);
      })
      .finally(() => {
        connection.encodingCount--;
      });
    // One failed submission must not poison later recovery, or reject unobserved on teardown.
    connection.encodeChain = result.catch(() => {});
    return result;
  }
  refresh() {
    if (!this.lobby) return;
    this.roster = this.members();
    if (
      this.api.owner(this.matchmaking, this.lobby).toString() !== this.hostId
    ) {
      this.fail("The host left. Resume a multiplayer save in a new lobby.");
      return;
    }
    this.publish();
  }
  async persist(world) {
    if (
      !world ||
      world.schema !== 3 ||
      !Array.isArray(world.seats) ||
      world.seats.length < 2 ||
      world.seats.length > 4 ||
      !world.seats.some((s) => s.id === this.service.identity.steamId)
    )
      throw new Error("Invalid multiplayer save");
    const json = stringify(world);
    if (Buffer.byteLength(json) > MAX_BYTES)
      throw new Error("Multiplayer save is too large");
    const digest = crypto.createHash("sha256").update(json).digest("hex");
    await this.saves.save(world);
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
    let encoded;
    // Only a receipt from this live connection proves the identical file is already there.
    // Keep writing locally, and retry peers whose last send or disk write never completed.
    for (const c of this.connections.values())
      if (
        c.connected &&
        c.savedDigest !== digest &&
        (c.checkpointDigest !== digest ||
          !c.checkpointQueue?.some((queued) => queued.digest === digest))
      )
        try {
          encoded ||= await encodeAsync(payload);
          if (
            !c.connected ||
            ![...this.connections.values()].includes(c) ||
            this.hostId !== this.service.identity.steamId ||
            c.savedDigest === digest ||
            // A newer local save may finish encoding first. Never replace it on the guest.
            digest !== this.checkpointHash
          )
            continue;
          this.send(c.id, payload, encoded);
          c.checkpointDigest = digest;
          // A different queued save can replace the file that the previous receipt proved.
          c.savedDigest = undefined;
        } catch {
          // Retried by the next periodic checkpoint.
        }
    return this.state();
  }
  /** One active disk write, with the newest pending checkpoint per admitted campaign. */
  queueCheckpoint(sender, { world, digest }, connection) {
    const matchId = world?.matchId;
    if (!boundedText(matchId, 200)) return;
    // Replace a waiting write in arrival order and evict the oldest if a new campaign fills
    // the queue. The latest checkpoint might be the last one the host sends.
    this.pendingCheckpoints.delete(matchId);
    if (this.pendingCheckpoints.size >= MAX_PENDING_CHECKPOINTS)
      this.pendingCheckpoints.delete(
        this.pendingCheckpoints.keys().next().value,
      );
    this.pendingCheckpoints.set(matchId, { sender, world, digest, connection });
    if (this.checkpointWrite) return;
    const current = (request) =>
      this.hostId === request.sender &&
      this.hostId !== this.service.identity.steamId &&
      request.connection.connected &&
      [...this.connections.values()].includes(request.connection);
    this.checkpointWrite = Promise.resolve().then(async () => {
      try {
        while (this.pendingCheckpoints.size) {
          const [pendingMatch, request] = this.pendingCheckpoints
            .entries()
            .next().value;
          this.pendingCheckpoints.delete(pendingMatch);
          if (!current(request)) continue;
          try {
            const savedDigest = await this.persist(request.world);
            if (savedDigest !== request.digest || !current(request)) continue;
            this.sharedAt = this.savedAt;
            this.publish();
            this.send(request.sender, { kind: "saved", digest: savedDigest });
          } catch {
            // No receipt: the next periodic checkpoint retries failed writes.
          }
        }
      } finally {
        this.checkpointWrite = undefined;
      }
    });
  }
  async receive(sender, payload) {
    if (
      !payload ||
      typeof payload !== "object" ||
      !MESSAGE_KINDS.has(payload.kind)
    )
      throw new Error("Invalid message");
    validReplicationMessage(payload);
    const senderConnection = [...this.connections.values()].find(
      (c) => c.id === sender && c.connected,
    );
    if (
      REPLICATION_HOST_KINDS.has(payload.kind) &&
      (sender !== this.hostId || this.hostId === this.service.identity.steamId)
    )
      throw new Error("Invalid replication sender");
    if (
      REPLICATION_GUEST_KINDS.has(payload.kind) &&
      (this.hostId !== this.service.identity.steamId || !senderConnection)
    )
      throw new Error("Invalid replication sender");
    if (payload.kind === "progress")
      senderConnection.lastHeartbeat = performance.now();
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
      if (!senderConnection) throw new Error("Invalid save sender");
      if (
        crypto
          .createHash("sha256")
          .update(stringify(payload.world))
          .digest("hex") !== payload.digest
      )
        throw new Error("Multiplayer save checksum failed");
      this.queueCheckpoint(sender, payload, senderConnection);
      return;
    }
    if (
      payload.kind === "saved" &&
      this.hostId === this.service.identity.steamId
    ) {
      // A guest can still be acknowledging the previous checkpoint when the next one starts.
      // That acknowledgement is stale, not hostile, so it must not drop the connection.
      const connection = [...this.connections.values()].find(
        (c) => c.id === sender && c.connected,
      );
      if (
        connection &&
        typeof payload.digest === "string" &&
        payload.digest === this.checkpointHash &&
        payload.digest === connection.checkpointDigest
      ) {
        connection.savedDigest = payload.digest;
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
      payload.kind !== "save-request" &&
      !REPLICATION_GUEST_KINDS.has(payload.kind)
    )
      throw new Error("Invalid guest message");
    if (
      ["save-request", "save-result"].includes(payload.kind) &&
      (typeof payload.requestId !== "string" || payload.requestId.length > 64)
    )
      throw new Error("Invalid save request");
    if (
      payload.kind === "save-request" &&
      payload.suspended !== undefined &&
      typeof payload.suspended !== "boolean"
    )
      throw new Error("Invalid save request");
    if (
      payload.kind === "browse" &&
      (!payload.browse ||
        Buffer.byteLength(JSON.stringify(payload.browse)) > MAX_BROWSE_BYTES)
    )
      throw new Error("Invalid scenario selection");
    if (
      payload.kind === "campaign" &&
      payload.campaign !== undefined &&
      (!payload.campaign ||
        Buffer.byteLength(JSON.stringify(payload.campaign)) >
          MAX_CAMPAIGN_BYTES)
    )
      throw new Error("Invalid campaign selection");
    if (payload.kind === "scenario") validScenarioMessage(payload);
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
      let sendFailed = false;
      for (let sent = 0; sent < 8; sent++) {
        const queue = c.queue.length ? c.queue : c.checkpointQueue;
        const outgoing = queue?.[0];
        if (!outgoing) break;
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
          if (outgoing.offset * CHUNK >= outgoing.bytes.length) queue.shift();
        } else {
          if (result !== RESULT_LIMIT_EXCEEDED) {
            this.drop(handle);
            sendFailed = true;
          }
          break;
        }
      }
      if (sendFailed) continue;
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
          if (this.connections.get(handle) !== c || !c.connected) continue;
          const prefix = Buffer.from(
            this.koffi.decode(pointer, "uint8_t", MESSAGE_PREFIX_SIZE),
          );
          const length = prefix.readInt32LE(MESSAGE_SIZE_OFFSET);
          if (length < HEADER || length > HEADER + CHUNK)
            throw new Error("Invalid frame size");
          const bytes = Buffer.from(
            this.koffi.decode(prefix.readBigUInt64LE(0), "uint8_t", length),
          );
          if ((c.pendingFrames?.length || 0) >= 64)
            throw new Error("Too many pending co-op frames");
          (c.pendingFrames ||= []).push(bytes);
          this.drainFrames(handle, c);
        } catch {
          this.drop(handle);
        } finally {
          this.api.release(pointer);
        }
      }
    }
  }
  /** A pump can complete eight tiny messages before any inflate callback runs. Defer new
   * transfers while the four-transfer budget is occupied, keeping native pointers released. */
  drainFrames(handle, connection) {
    try {
      while (
        connection.pendingFrames?.length &&
        this.connections.get(handle) === connection &&
        connection.connected
      ) {
        const bytes = connection.pendingFrames[0];
        const key = bytes.subarray(4, 12).toString("hex");
        if (
          connection.incoming.size >= 4 &&
          !connection.incoming.has(key) &&
          [...connection.incoming.values()].some(
            (transfer) => transfer.inflater,
          )
        )
          return;
        connection.pendingFrames.shift();
        const completion = assemble(connection.incoming, bytes);
        if (!completion) continue;
        // Decode order is transport order, independent of asynchronous inflate completion.
        const decoded = completion.then(
          (payload) => ({ payload }),
          (error) => ({ error }),
        );
        if ((connection.deliveryCount || 0) >= 64)
          throw new Error("Too many pending co-op messages");
        connection.deliveryCount = (connection.deliveryCount || 0) + 1;
        connection.delivery = (connection.delivery || Promise.resolve())
          .then(async () => {
            const result = await decoded;
            if (
              this.connections.get(handle) !== connection ||
              !connection.connected
            )
              return;
            if (result.error) throw result.error;
            await this.receive(connection.id, result.payload);
          })
          .catch(() => {
            if (this.connections.get(handle) === connection) this.drop(handle);
          })
          .finally(() => {
            connection.deliveryCount--;
            if (this.connections.get(handle) === connection)
              this.drainFrames(handle, connection);
          });
      }
    } catch {
      if (this.connections.get(handle) === connection) this.drop(handle);
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
    this.inviteCode = undefined;
    this.listener = undefined;
    this.hostId = undefined;
    this.roster = [];
    this.allowed = null;
    this.error = undefined;
    this.sharedAt = null;
    this.pendingInvite = undefined;
    this.pendingCheckpoints.clear();
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
          input.value.length > (input.key === "ready" ? 256 : 64) ||
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
        if (!this.lobby) throw new Error("Host a game before inviting friends");
        this.service.requireOverlay();
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
        return this.saves.select(input.id);
      }
      case "list-saves":
        return this.saves.list(input.sync === true);
      case "delete-save":
        await this.saves.remove(input.id);
        return this.saves.list();
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
  encodeAsync,
  chunk,
  assemble,
  stringify,
  parse,
  lobbyFromArgs,
};
