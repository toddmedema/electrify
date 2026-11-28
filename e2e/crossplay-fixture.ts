import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import type { Page } from "@playwright/test";
import { decodeWire, encodeWire } from "../src/multiplayer/WireJson";
import type { World } from "../src/multiplayer/Types";

const api = "https://us-central1-electrify-game.cloudfunctions.net/coopV2/";
const googleKey = "CONTACT-ADMIN-TO-GET-KEY";
const fakeOrigin = "https://electrifygame.com";
const relayAddress = "141.101.65.1";

type RequestData = Record<string, unknown>;
type Checkpoint = {
  id: string;
  generation: string;
  digest: string;
  bytes: number;
  name: string;
  savedAt: number;
  epoch: string;
  matchId: string;
  schema: number;
  revision: number;
  scenarioDigest: string;
};
type RoomMember = {
  id: string;
  account: string;
  binding: string;
  name: string;
  active: boolean;
};
type Room = {
  id: string;
  epoch: string;
  hostId: string;
  leaseUntil: number;
  members: RoomMember[];
  invite?: { codeHash: string; linkHash: string };
  head?: Checkpoint;
  signals?: Partial<Record<string, Signal>>;
};
type Account = {
  tokenHash: string;
  binding: string;
  deviceHash: string;
  priorTokenHash?: string;
  expiresAt: number;
  revoked: boolean;
};
type Signal = {
  epoch: string;
  generation: string;
  hostId: string;
  hostBinding: string;
  guestId: string;
  guestBinding: string;
  createdAt: number;
  expiresAt: number;
  successor?: Signal;
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
  renegotiatedAt?: number;
  negotiation?: number;
  drained?: Record<string, boolean>;
};
// Keep these aligned with firebase/functions/coop-signaling.cjs.
const PREPARE_WINDOW_MS = 56_000;
const RENEGOTIATE_MS = 10_000;
const ROTATION_WINDOW_MS = 25_000;
const FAILED_GENERATION_MS = 15_000;
type BrowserPlayer = {
  platform: "web" | "steam";
  externalId: string;
  account: string;
};
type FixtureOptions = {
  name?: string;
  identity?: string;
  installBridge?: boolean;
};

const hash = (source: Buffer | string) =>
  createHash("sha256").update(source).digest("hex");

function syntheticGoogleToken(user: string) {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    aud: "electrify-game",
    sub: user,
    iat: now,
    auth_time: now,
    exp: now + 3600,
    firebase: { sign_in_provider: "google.com" },
  };
  return (
    Buffer.from('{"alg":"none"}').toString("base64url") +
    "." +
    Buffer.from(JSON.stringify(claims)).toString("base64url") +
    ".fixture"
  );
}

async function installGoogleProof(page: Page, name: string, uid: string) {
  const key = process.env.CROSSPLAY_TEST_FIREBASE_API_KEY || googleKey;
  const token = syntheticGoogleToken(uid);
  const user = {
    uid,
    displayName: name,
    emailVerified: true,
    isAnonymous: false,
    providerData: [{ providerId: "google.com", uid, displayName: name }],
    stsTokenManager: {
      refreshToken: "fixture-refresh",
      accessToken: token,
      expirationTime: Date.now() + 3_600_000,
    },
    apiKey: key,
    appName: "[DEFAULT]",
  };
  await page.addInitScript((user) => {
    localStorage.setItem(
      "firebase:authUser:" + user.apiKey + ":[DEFAULT]",
      JSON.stringify(user),
    );
  }, user);
  await page.route("https://identitytoolkit.googleapis.com/**", (route) =>
    route.fulfill({
      json: {
        users: [
          {
            localId: uid,
            displayName: name,
            emailVerified: true,
            providerUserInfo: user.providerData.map((provider) => ({
              ...provider,
              rawId: uid,
            })),
          },
        ],
      },
    }),
  );
  await page.route("https://securetoken.googleapis.com/**", (route) =>
    route.fulfill({
      json: {
        access_token: token,
        id_token: token,
        user_id: uid,
        refresh_token: "fixture-refresh",
        expires_in: "3600",
        token_type: "Bearer",
        project_id: "electrify-game",
      },
    }),
  );
  await page.route("https://firestore.googleapis.com/**", (route) =>
    route.fulfill({
      status: 403,
      json: { error: { status: "PERMISSION_DENIED" } },
    }),
  );
  return token;
}

async function installSteamBridge(
  page: Page,
  steamEdition: boolean,
  name = "Steam Engineer",
) {
  await page.addInitScript(
    ({ steamEdition, name }) => {
      const display = {
        fullscreen: false,
        width: 1280,
        height: 900,
        resolutions: [],
      };
      const noop = () => () => {};
      window.electrifyDesktop = {
        apiVersion: 1,
        steamEdition,
        getState: async () => ({
          display,
          steam: {
            available: steamEdition,
            online: steamEdition,
            cloudEnabled: false,
            displayName: name,
          },
        }),
        setDisplay: async () => display,
        couchRequest: async () => ({ available: steamEdition, devices: [] }),
        onMultiplayerEvent: noop,
        onStateChanged: noop,
        onGameFocusChanged: noop,
        onBeforeQuit: noop,
        readyToQuit: () => {},
        quit: async () => {},
        readSaveLibrary: async () => ({
          local: null,
          cloud: null,
          cloudState: "disabled",
        }),
        writeSaveLibrary: async () => ({ cloudState: "disabled" }),
        getLeaderboard: async () => [],
        submitScore: async () => {},
        openFriends: async () => {},
        multiplayerRequest: async () => ({
          available: false,
          members: [],
          connected: [],
        }),
        crossplayRequest: (operation, body, _requestId, userAction) =>
          (window as unknown as SimulationBridge).crossplayInvoke(
            operation,
            body,
            userAction,
          ),
      };
    },
    { steamEdition, name },
  );
}

export { installSteamBridge };

interface SimulationBridge {
  crossplayInvoke(
    operation: string,
    body: unknown,
    userAction: boolean,
  ): Promise<{ ok: true; value: unknown } | { ok: false; code: string }>;
  allocateCrossplayPort(): Promise<number>;
  connectCrossplayPeer(local: number, remote: number): Promise<void>;
  openCrossplayPeer?(local: number, remote: number): void;
  crossplayWire(
    source: number,
    destination: number,
    bytes: number[],
  ): Promise<void>;
  receiveCrossplayFrames?(
    source: number,
    destination: number,
    frames: string[],
  ): void;
  closeCrossplayPeer?(remotePorts: number[]): void;
}

async function installWebRtcSimulation(page: Page, address: string) {
  await page.addInitScript((address) => {
    const bridge = window as unknown as SimulationBridge;
    const connections = new Map<number, PeerConnection>();
    const parseCandidate = (description?: RTCSessionDescriptionInit) =>
      /a=candidate:\S+ 1 udp \d+ (\S+) (\d+) typ relay/.exec(
        description?.sdp ?? "",
      );

    class Channel {
      binaryType = "arraybuffer";
      bufferedAmount = 0;
      readyState = "connecting";
      onmessage?: (event: { data: ArrayBuffer }) => void;
      onopen?: () => void;
      onclose?: () => void;

      constructor(private peer: PeerConnection) {}

      send(payload: Uint8Array | ArrayBuffer) {
        const { localPort, remotePort } = this.peer;
        if (this.readyState !== "open" || !localPort || !remotePort)
          throw new Error("The simulated channel is closed");
        void bridge
          .crossplayWire(
            localPort,
            remotePort,
            Array.from(new Uint8Array(payload)),
          )
          .catch(() => this.peer.close());
      }

      close() {
        if (this.readyState === "closed") return;
        this.readyState = "closed";
        this.onclose?.();
      }
    }

    class PeerConnection {
      connectionState = "new";
      iceGatheringState = "complete";
      localDescription?: RTCSessionDescriptionInit;
      remoteDescription?: RTCSessionDescriptionInit;
      onconnectionstatechange?: () => void;
      channel?: Channel;
      localPort?: number;
      remotePort?: number;
      connecting = false;

      constructor(config: RTCConfiguration) {
        if (!config.iceServers?.length)
          throw new Error("Expected configured TURN for relay-only connection");
      }

      createDataChannel(label: string, config: RTCDataChannelInit) {
        if (
          label !== "electrify-coop-v2" ||
          !config.negotiated ||
          !config.ordered
        )
          throw new Error("Expected the ordered negotiated co-op channel");
        this.channel = new Channel(this);
        return this.channel;
      }

      async description(
        type: "offer" | "answer",
      ): Promise<RTCSessionDescriptionInit> {
        this.localPort ??= await bridge.allocateCrossplayPort();
        connections.set(this.localPort, this);
        return {
          type,
          sdp:
            [
              "v=0",
              "o=- 1 1 IN IP4 0.0.0.0",
              "s=-",
              "t=0 0",
              "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
              "c=IN IP4 0.0.0.0",
              `a=candidate:fixture 1 udp 1 ${address} ${this.localPort} typ relay`,
            ].join("\r\n") + "\r\n",
        };
      }

      async createOffer() {
        return this.description("offer");
      }

      async createAnswer() {
        return this.description("answer");
      }

      async setLocalDescription(description: RTCSessionDescriptionInit) {
        this.localDescription = description;
        this.connect();
      }
      async setRemoteDescription(description: RTCSessionDescriptionInit) {
        this.remoteDescription = description;
        this.remotePort = Number(parseCandidate(description)?.[2]);
        this.connect();
      }

      connect() {
        if (
          !this.localDescription ||
          !this.remoteDescription ||
          !this.channel ||
          this.connectionState === "closed" ||
          this.connecting ||
          this.localPort === undefined ||
          this.remotePort === undefined
        )
          return;
        this.connecting = true;
        void bridge
          .connectCrossplayPeer(this.localPort, this.remotePort)
          .catch(() => this.close());
      }

      open() {
        if (!this.channel || this.connectionState === "closed") return;
        this.channel.readyState = "open";
        this.connectionState = "connected";
        this.channel.onopen?.();
        this.onconnectionstatechange?.();
      }

      async getStats() {
        const remote = parseCandidate(this.remoteDescription);
        return new Map<string, object>([
          ["transport", { type: "transport", selectedCandidatePairId: "pair" }],
          [
            "pair",
            {
              type: "candidate-pair",
              state: "succeeded",
              localCandidateId: "local",
              remoteCandidateId: "remote",
            },
          ],
          [
            "local",
            {
              type: "local-candidate",
              candidateType: "relay",
              address,
              port: this.localPort,
            },
          ],
          [
            "remote",
            {
              type: "remote-candidate",
              candidateType: "relay",
              address: remote?.[1],
              port: this.remotePort,
            },
          ],
        ]);
      }

      close() {
        if (this.connectionState === "closed") return;
        this.connectionState = "closed";
        if (this.localPort !== undefined) connections.delete(this.localPort);
        this.channel?.close();
        this.onconnectionstatechange?.();
      }
    }

    bridge.openCrossplayPeer = (local, remote) => {
      const peer = connections.get(local);
      if (peer?.remotePort === remote) peer.open();
    };

    bridge.receiveCrossplayFrames = (source, destination, frames) => {
      for (const frame of frames) {
        const peer = connections.get(destination);
        if (
          peer?.remotePort !== source ||
          peer.channel?.readyState === "closed"
        )
          continue;
        try {
          const data = Uint8Array.from(atob(frame), (char) =>
            char.charCodeAt(0),
          ).buffer;
          peer.channel?.onmessage?.({ data });
        } catch (error) {
          // A thrown message handler must not discard the rest of the batch.
          window.reportError(error);
        }
      }
    };

    bridge.closeCrossplayPeer = (remotePorts) => {
      const ports = new Set(remotePorts);
      for (const connection of connections.values())
        if (
          ports.has(connection.remotePort ?? -1) ||
          ports.has(connection.localPort ?? -1)
        )
          connection.close();
    };

    Object.defineProperty(window, "RTCPeerConnection", {
      configurable: true,
      value: new Proxy(window.RTCPeerConnection, {
        construct(target, args) {
          return args[0]?.iceTransportPolicy === "relay"
            ? new PeerConnection(args[0])
            : Reflect.construct(target, args);
        },
      }),
    });
  }, address);
}

type ObjectMetadata = {
  generation: string;
  size: number;
  metadata?: Record<string, unknown>;
};

function storageFixture() {
  const objects = new Map<
    string,
    { bytes: Buffer; metadata: ObjectMetadata }
  >();
  let generation = 0;
  return {
    objects,
    file(key: string, options: { generation?: string } = {}) {
      const stored = () => {
        const object = objects.get(key);
        if (
          !object ||
          (options.generation &&
            options.generation !== object.metadata.generation)
        )
          throw Object.assign(new Error("Unknown storage object generation"), {
            code: 404,
          });
        return object;
      };
      return {
        async save(
          bytes: Buffer,
          options: {
            preconditionOpts: { ifGenerationMatch: number };
            metadata?: { metadata?: Record<string, unknown> };
          },
        ) {
          if (
            options.preconditionOpts.ifGenerationMatch !== 0 ||
            objects.has(key)
          )
            throw Object.assign(new Error("Storage precondition failed"), {
              code: 412,
            });
          objects.set(key, {
            bytes: Buffer.from(bytes),
            metadata: {
              generation: String(++generation),
              size: bytes.length,
              metadata: options.metadata?.metadata,
            },
          });
        },
        async getMetadata() {
          return [stored().metadata];
        },
        async download() {
          return [Buffer.from(stored().bytes)];
        },
        async delete(options: { ifGenerationMatch: string }) {
          if (stored().metadata.generation !== options.ifGenerationMatch)
            throw Object.assign(new Error("Storage precondition failed"), {
              code: 412,
            });
          objects.delete(key);
        },
      };
    },
  };
}

let validator: Promise<string> | undefined;
function checkpointValidator() {
  if (!validator) {
    const directory = mkdtempSync(
      path.join(tmpdir(), "electrify-crossplay-e2e-"),
    );
    process.once("exit", () =>
      rmSync(directory, { recursive: true, force: true }),
    );
    const { buildCheckpointValidator } =
      require("../scripts/build-coop-checkpoint-validator") as {
        buildCheckpointValidator(output: string): Promise<void>;
      };
    validator = buildCheckpointValidator(directory).then(() =>
      path.join(directory, "runtime/server/checkpoint.cjs"),
    );
  }
  return validator;
}

type Extension = (
  operation: string,
  context: {
    room: Room;
    seatId: string;
    now: number;
    updateRoom<Result>(
      update: (
        room: Room,
        now: number,
        projected: Room,
      ) => { room?: Room; value?: Result },
      guard?: string | { type: string; peerId: string },
    ): Promise<Result>;
  },
  body: RequestData,
) => unknown;

const iceServers = [
  {
    urls: ["turn:turn.cloudflare.com:3478", "turns:turn.cloudflare.com:443"],
    username: "fixture",
    credential: "fixture",
  },
];

/** Drive the real UI, workers, room API and checkpoint validation. Platform
 * identity proofs, provider signaling, Firestore, Storage and WebRTC are simulated. */
export function crossplayFixture() {
  const {
    createCrossplay,
  } = require("../firebase/functions/crossplay-http.cjs");
  const {
    CrossplayError,
  } = require("../firebase/functions/crossplay-errors.cjs");
  const { handle: checkpoint } =
    require("../firebase/functions/coop-checkpoints.cjs") as {
      handle: (
        operation: string,
        context: object,
        body: RequestData,
      ) => Promise<unknown>;
    };
  const rooms = new Map<string, Room>();
  const accounts = new Map<string, Account>();
  const acceptedGoogleProofs = new Map<string, string>();
  const acceptedSteamProofs = new Map<string, string>();
  const steamUsers = new Map<string, string>();
  const usedTickets = new Set<string>();
  const fixtureStarted = Date.now();
  const operations: {
    operation: string;
    page?: Page;
    status: number;
    startedMs: number;
    error?: string;
    explicit?: boolean;
    durationMs?: number;
    leaseRemainingMs?: number;
  }[] = [];
  const players = new Map<Page, BrowserPlayer>();
  const pageRooms = new Map<Page, string>();
  const ports = new Map<number, Page>();
  const negotiation = new Map<number, number>();
  const bridges = new Map<
    Page,
    Awaited<ReturnType<ReturnType<Page["context"]>["newCDPSession"]>>
  >();
  const wireQueues = new Map<string, string[]>();
  const offline = new Set<Page>();
  const lostAuthority = new Set<Page>();
  const bucket = storageFixture();
  let nextPort = 24000;
  let allAuthorityLost = false;
  let saveFailure: string | undefined;
  const currentRoom = (id: string) => ({
    room: structuredClone(rooms.get(id) ?? null),
    snapshot: rooms.get(id),
    now: Date.now(),
  });

  const signal: Extension = async (operation, context, body) =>
    context.updateRoom<unknown>((draft, now, room) => {
      const host = room.members.find(
        ({ id, active }) => id === room.hostId && active,
      );
      const { seatId } = context;
      const guests = room.members.filter(
        ({ id, active }) =>
          active &&
          id !== room.hostId &&
          (seatId === room.hostId || id === seatId),
      );
      if (!host) throw new CrossplayError(409, "authority_changed");
      const signals = (draft.signals ??= {});
      const freshPair = (guest: RoomMember): Signal => ({
        epoch: room.epoch,
        generation: randomUUID(),
        hostId: host.id,
        hostBinding: host.binding,
        guestId: guest.id,
        guestBinding: guest.binding,
        createdAt: now,
        expiresAt: now + 140_000,
      });
      const eligible = (pair: Signal, guest: RoomMember) =>
        pair.epoch === room.epoch &&
        pair.hostId === host.id &&
        pair.hostBinding === host.binding &&
        pair.guestBinding === guest.binding &&
        pair.expiresAt > now;
      const format = (pair: Signal) => ({
        generation: pair.generation,
        remainingMs: pair.expiresAt - now,
        negotiation: pair.negotiation ?? 0,
        offer: pair.offer,
        answer: pair.answer,
      });
      if (operation === "signal/read") {
        let changed = false;
        const pairs = guests.map((guest) => {
          let pair = signals[guest.id];
          if (!pair || !eligible(pair, guest)) {
            changed = true;
            const successor = pair?.successor;
            pair = signals[guest.id] =
              successor && eligible(successor, guest)
                ? successor
                : freshPair(guest);
          }
          return {
            peerId: seatId === host.id ? guest.id : host.id,
            ...format(pair),
            ...(pair.successor && { successor: format(pair.successor) }),
          };
        });
        return { room: changed ? draft : undefined, value: { pairs } };
      }
      const guest = guests.find(
        ({ id }) => (seatId === host.id ? id : host.id) === body.to,
      );
      const current = guest && signals[guest.id];
      const staged = current?.generation !== body.generation;
      const pair = staged ? current?.successor : current;
      if (
        !guest ||
        !current ||
        !pair ||
        !eligible(pair, guest) ||
        pair.generation !== body.generation
      )
        throw new CrossplayError(409, "obsolete-connection");
      if (operation === "signal/turn")
        return { value: { iceServers, remainingMs: pair.expiresAt - now } };
      if (operation === "signal/prepare") {
        if (staged || !pair.offer || !pair.answer)
          throw new CrossplayError(409, "obsolete-connection");
        if (pair.expiresAt - now > PREPARE_WINDOW_MS)
          throw new CrossplayError(429, "turn-rotation-limit");
        current.successor ??= freshPair(guest);
      } else if (operation === "signal/reset") {
        const deadline =
          pair.offer && pair.answer
            ? pair.createdAt + ROTATION_WINDOW_MS
            : pair.createdAt + FAILED_GENERATION_MS;
        if (now < deadline)
          throw new CrossplayError(429, "turn-rotation-limit");
        if (staged) current.successor = freshPair(guest);
        else delete signals[pair.guestId];
      } else if (operation === "signal/renegotiate") {
        if (
          pair.renegotiatedAt !== undefined &&
          now < pair.renegotiatedAt + RENEGOTIATE_MS
        )
          throw new CrossplayError(429, "turn-rotation-limit");
        delete pair.offer;
        delete pair.answer;
        delete pair.drained;
        delete current.drained;
        pair.negotiation = (pair.negotiation ?? 0) + 1;
        pair.renegotiatedAt = now;
        if (!staged) delete current.successor;
        else current.negotiation = (current.negotiation ?? 0) + 1;
      } else if (operation === "signal/drained") {
        const vote =
          typeof body.negotiation === "number" ? body.negotiation : 0;
        if (
          !staged &&
          current.offer &&
          current.answer &&
          vote === (current.negotiation ?? 0)
        ) {
          current.drained = { ...current.drained, [seatId]: true };
          if (
            current.successor &&
            current.drained[current.hostId] &&
            current.drained[current.guestId]
          )
            signals[current.guestId] = current.successor;
        }
      } else {
        const description = body.description as RTCSessionDescriptionInit;
        if (description?.type === "offer" && seatId === host.id)
          pair.offer = description;
        else if (description?.type === "answer" && seatId === pair.guestId)
          pair.answer = description;
        else throw new CrossplayError(400, "invalid_description");
      }
      return { room: draft, value: {} };
    });

  const durable: Extension = async (operation, context, body) => {
    if (
      operation === "save/publish" &&
      context.seatId === context.room.hostId &&
      saveFailure
    )
      throw new CrossplayError(503, saveFailure);
    return checkpoint(
      operation,
      {
        ...context,
        bucket,
        ...(operation === "save/publish" && {
          checkpointValidatorPath: await checkpointValidator(),
        }),
      },
      body,
    );
  };

  const reservedCodes = new Map<string, { id: string; expiresAt: number }>();
  const service = createCrossplay({
    origins: [fakeOrigin],
    quotaKey: "playwright-crossplay-fixture-only",
    verifyGoogle: async (token: string) => ({
      uid: acceptedGoogleProofs.get(token),
      firebase: { sign_in_provider: "google.com" },
    }),
    verifySteam: async (ticket: string) => acceptedSteamProofs.get(ticket),
    store: {
      account: async (id: string) => accounts.get(id),
      accounts: async (ids: string[]) => ids.map((id) => accounts.get(id)),
      consume: async () => true,
      consumeTicket: async (ticketHash: string) => {
        if (usedTickets.has(ticketHash)) return false;
        usedTickets.add(ticketHash);
        return true;
      },
      issue: async (id: string, account: Account) => {
        const previous = accounts.get(id);
        if (
          account.priorTokenHash &&
          previous?.tokenHash !== account.priorTokenHash
        )
          return null;
        const binding =
          previous?.deviceHash === account.deviceHash && !previous.revoked
            ? previous.binding
            : account.binding;
        accounts.set(id, { ...account, binding });
        return binding;
      },
      revoke: async (id: string, tokenHash: string) => {
        const previous = accounts.get(id);
        if (previous?.tokenHash === tokenHash)
          accounts.set(id, { ...previous, revoked: true });
      },
      reserveRoom: async () => true,
      reserveInviteCode: async (
        digest: string,
        id: string,
        expiresAt: number,
      ) => {
        const reserved = reservedCodes.get(digest);
        if (reserved && reserved.expiresAt > Date.now()) return false;
        reservedCodes.set(digest, { id, expiresAt });
        return true;
      },
      getRoom: async (id: string) => currentRoom(id),
      findInvite: async (digest: string, shortCode?: boolean) => {
        if (shortCode) {
          const reserved = reservedCodes.get(digest);
          return reserved && reserved.expiresAt > Date.now()
            ? currentRoom(reserved.id)
            : null;
        }
        const room = [...rooms.values()].find(
          ({ invite }) =>
            invite?.codeHash === digest || invite?.linkHash === digest,
        );
        return room && currentRoom(room.id);
      },
      listRooms: async (account: string) =>
        [...rooms.values()]
          .filter(({ members }) =>
            members.some((member) => member.account === account),
          )
          .map(({ id }) => currentRoom(id)),
      writeRoom: async (
        version: Room | null,
        room: Room,
        actor: Account & { account: string },
        guard: { deadline: number },
      ) => {
        if (
          guard.deadline <= Date.now() ||
          accounts.get(actor.account)?.tokenHash !== actor.tokenHash ||
          rooms.get(room.id) !== (version ?? undefined)
        )
          return false;
        rooms.set(room.id, structuredClone(room));
        return true;
      },
    },
    extensions: { signal, save: durable, transfer: durable },
  });

  async function request(
    page: Page,
    operation: string,
    body: unknown,
    bearer?: string,
    origin?: string,
  ) {
    const started = Date.now();
    const result = { status: 500, body: {} as RequestData };
    const headers: Record<string, string | undefined> = {
      origin,
      authorization: bearer,
      "content-type": "application/json",
    };
    if (
      offline.has(page) ||
      (operation === "room/state" &&
        (allAuthorityLost || lostAuthority.has(page)))
    ) {
      operations.push({
        operation,
        page,
        startedMs: started - fixtureStarted,
        status: 503,
        error: "unavailable",
      });
      return { status: 503, body: { error: "unavailable" } as RequestData };
    }
    await service.handle(
      {
        originalUrl: "/coopV2/" + operation,
        path: "/" + operation,
        socket: { remoteAddress: "127.0.0.1" },
        get: (name: string) => headers[name],
        rawBody: Buffer.from(JSON.stringify(body)),
        method: "POST",
      },
      {
        set: () => {},
        status(status: number) {
          result.status = status;
          return this;
        },
        json(value: RequestData) {
          result.body = value;
        },
      },
    );
    const lobby = result.body?.lobby as { lobbyId?: string } | undefined;
    if (lobby?.lobbyId) pageRooms.set(page, lobby.lobbyId);
    const authority = result.body?.authority as
      { leaseRemainingMs?: number } | undefined;
    operations.push({
      operation,
      page,
      startedMs: started - fixtureStarted,
      status: result.status,
      leaseRemainingMs: authority?.leaseRemainingMs,
      ...(operation === "save/publish" && {
        explicit: (body as RequestData)?.explicit === true,
      }),
      durationMs: Date.now() - started,
      ...(typeof result.body?.error === "string" && {
        error: result.body.error,
      }),
    });
    return result;
  }

  function roomId(page?: Page) {
    return page ? pageRooms.get(page) : [...rooms.keys()].at(-1);
  }

  function seatId(page: Page, id = roomId(page)) {
    return (
      id &&
      rooms
        .get(id)
        ?.members.find(({ account }) => players.get(page)?.account === account)
        ?.id
    );
  }

  /**
   * The campaign's room is the newest one that holds a save. A player who opens a lobby only to
   * load a save leaves a newer room behind that has none.
   */
  function campaignRoomId() {
    const ids = [...rooms.keys()];
    return ids.findLast((id) => rooms.get(id)?.head) ?? ids.at(-1);
  }

  function savedCheckpoint(id = campaignRoomId()) {
    const room = id ? rooms.get(id) : undefined;
    const manifest = room?.head;
    const object =
      manifest && bucket.objects.get(`checkpoints/${id}/${manifest.id}`);
    return object
      ? (decodeWire(gunzipSync(object.bytes).toString("utf8")) as World)
      : undefined;
  }

  return {
    operations,
    elapsedMs: () => Date.now() - fixtureStarted,
    hostSeat: (page: Page) => rooms.get(roomId(page) ?? "")?.hostId,
    // Compile outside the running campaign so the fixture cannot stall its lease clock.
    prepareCheckpoints: checkpointValidator,
    roomId,
    seatId,
    checkpoint: savedCheckpoint,
    async replaceCheckpoint(world: World, id = roomId()) {
      const { validateCheckpoint } = require(await checkpointValidator());
      const room = id ? rooms.get(id) : undefined;
      const head = room?.head;
      if (!room || !head)
        throw new Error("Expected a saved campaign to advance");
      const wire = encodeWire(world);
      const fields = validateCheckpoint(wire);
      if (
        fields.matchId !== head.matchId ||
        fields.epoch !== head.epoch ||
        fields.scenarioDigest !== head.scenarioDigest ||
        fields.revision < head.revision ||
        JSON.stringify(fields.seats) !==
          JSON.stringify(room.members.map(({ id, name }) => ({ id, name })))
      )
        throw new Error(
          "The advanced checkpoint must continue the same campaign",
        );
      const bytes = gzipSync(Buffer.from(wire));
      const checkpointId = randomUUID();
      const file = bucket.file(`checkpoints/${room.id}/${checkpointId}`);
      await file.save(bytes, { preconditionOpts: { ifGenerationMatch: 0 } });
      const [metadata] = await file.getMetadata();
      const current = rooms.get(room.id);
      if (current?.head?.id !== head.id)
        throw new Error(
          "The saved campaign changed while installing the advanced checkpoint",
        );
      rooms.set(room.id, {
        ...current,
        head: {
          ...head,
          ...fields,
          id: checkpointId,
          bytes: bytes.length,
          digest: hash(bytes),
          generation: metadata.generation,
          savedAt: Date.now(),
        },
      });
    },
    failSaves(error?: string) {
      saveFailure = error;
    },
    loseAuthority(page?: Page) {
      if (page) lostAuthority.add(page);
      else allAuthorityLost = true;
    },
    restoreAuthority(page?: Page) {
      if (page) lostAuthority.delete(page);
      else allAuthorityLost = false;
    },
    expireHost(id = roomId()) {
      const room = id ? rooms.get(id) : undefined;
      if (!room) throw new Error("Expected an active campaign to expire");
      rooms.set(room.id, { ...room, leaseUntil: Date.now() - 1 });
    },
    async disconnect(page: Page) {
      offline.add(page);
      const id = roomId(page);
      const room = id ? rooms.get(id) : undefined;
      if (room) {
        const lost = seatId(page, id);
        rooms.set(room.id, {
          ...room,
          members: room.members.map((member) =>
            member.id === lost ? { ...member, active: false } : member,
          ),
        });
      }
      const lostPorts = [...ports]
        .filter(([, owner]) => owner === page)
        .map(([port]) => port);
      await Promise.all(
        [...bridges]
          .filter(([browser]) => !browser.isClosed())
          .map(([, bridge]) =>
            bridge.send("Runtime.evaluate", {
              expression: `window.closeCrossplayPeer?.(${JSON.stringify(lostPorts)})`,
            }),
          ),
      );
    },
    reconnect(page: Page) {
      offline.delete(page);
    },
    async install(
      page: Page,
      platform: "web" | "steam",
      options: FixtureOptions = {},
    ) {
      const index = players.size + 1;
      const identity = options.identity ?? `${platform}-engineer-${index}`;
      const name =
        options.name ??
        (platform === "web" ? "Web Engineer" : "Steam Engineer");
      if (platform === "steam" && !steamUsers.has(identity))
        steamUsers.set(
          identity,
          String(76561198000000000n + BigInt(steamUsers.size + 1)),
        );
      const externalId =
        platform === "steam" ? steamUsers.get(identity)! : identity;
      players.set(page, {
        platform,
        externalId,
        account: hash(
          `${platform === "web" ? "google" : platform}:${externalId}`,
        ),
      });
      const bridge = await page.context().newCDPSession(page);
      bridges.set(page, bridge);
      page.once("close", () => {
        bridges.delete(page);
        for (const [port, owner] of ports) {
          if (owner !== page) continue;
          ports.delete(port);
          negotiation.delete(port);
        }
      });
      await page.exposeBinding("allocateCrossplayPort", () => {
        const port = ++nextPort;
        ports.set(port, page);
        return port;
      });
      await page.exposeBinding(
        "connectCrossplayPeer",
        async (_, local: number, remote: number) => {
          const other = ports.get(remote);
          if (
            ports.get(local) !== page ||
            !other ||
            other.isClosed() ||
            offline.has(page) ||
            offline.has(other)
          )
            return;
          negotiation.set(local, remote);
          if (negotiation.get(remote) !== local) return;
          await Promise.all([
            bridge.send("Runtime.evaluate", {
              expression: `window.openCrossplayPeer?.(${local}, ${remote})`,
            }),
            bridges.get(other)?.send("Runtime.evaluate", {
              expression: `window.openCrossplayPeer?.(${remote}, ${local})`,
            }),
          ]);
        },
      );
      await page.exposeBinding(
        "crossplayWire",
        async (_, source: number, destination: number, data: number[]) => {
          const recipient = ports.get(destination);
          if (
            ports.get(source) !== page ||
            !recipient ||
            recipient.isClosed() ||
            offline.has(page) ||
            offline.has(recipient)
          )
            return;
          const payload = Buffer.from(data).toString("base64");
          const key = `${source}:${destination}`;
          const pending = wireQueues.get(key);
          if (pending) {
            pending.push(payload);
            return;
          }
          const queue = [payload];
          wireQueues.set(key, queue);
          try {
            // Keep the channel ordered while a slow renderer is evaluating a
            // delivery. Send all waiting frames in the next CDP round trip.
            while (queue.length) {
              const frames = queue.splice(0);
              await bridges.get(recipient)?.send("Runtime.evaluate", {
                expression: `window.receiveCrossplayFrames?.(${source}, ${destination}, ${JSON.stringify(frames)})`,
              });
            }
          } finally {
            wireQueues.delete(key);
          }
        },
      );
      await installWebRtcSimulation(page, relayAddress);
      if (platform === "steam") {
        let auth: string | undefined;
        const device = randomBytes(32).toString("base64url");
        await page.exposeBinding(
          "crossplayInvoke",
          async (_, operation: string, body: unknown, userAction: boolean) => {
            if (!auth) {
              if (!userAction) return { ok: false, code: "unauthenticated" };
              const ticket = randomBytes(64).toString("hex");
              acceptedSteamProofs.set(ticket, externalId);
              const proof = await request(page, "auth/steam", {
                ticket,
                device,
              });
              acceptedSteamProofs.delete(ticket);
              if (proof.status !== 200)
                return { ok: false, code: proof.body.error };
              auth = "Bearer " + proof.body.token;
            }
            const reply = await request(page, operation, body, auth);
            return reply.status === 200
              ? { ok: true, value: reply.body }
              : { ok: false, code: reply.body.error };
          },
        );
        if (options.installBridge !== false)
          await installSteamBridge(page, true, name);
      } else {
        const token = await installGoogleProof(page, name, externalId);
        acceptedGoogleProofs.set(token, externalId);
        await page.route(api + "**", async (route) => {
          const incoming = route.request();
          const operation = incoming.url().slice(api.length);
          const reply = await request(
            page,
            operation,
            incoming.postDataJSON(),
            incoming.headers().authorization,
            fakeOrigin,
          );
          await route.fulfill({ status: reply.status, json: reply.body });
        });
      }
    },
  };
}
