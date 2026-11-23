import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";

const api = "https://us-central1-electrify-game.cloudfunctions.net/coopV2/";
const googleKey = "CONTACT-ADMIN-TO-GET-KEY";
const desktopTicket = "a1".repeat(128);
const fakeOrigin = "https://electrifygame.com";
const relayAddress = "141.101.65.1";

type RequestData = Record<string, unknown>;
type Checkpoint = { name: string; savedAt: number; epoch: string };
type Room = {
  id: string;
  epoch: string;
  hostId: string;
  members: { id: string; account: string; active: boolean }[];
  invite?: { codeHash: string; linkHash: string };
  head?: Checkpoint;
};
type Account = { tokenHash: string; binding: string; revoked: boolean };
type Signal = {
  epoch: string;
  generation: string;
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
};

function syntheticGoogleToken(user: string) {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    aud: "electrify-game",
    sub: user,
    iat: now,
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

async function installSteamBridge(page: Page, steamEdition: boolean) {
  await page.addInitScript((steamEdition) => {
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
          displayName: "Steam Engineer",
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
  }, steamEdition);
}

export { installSteamBridge };

interface SimulationBridge {
  crossplayInvoke(
    operation: string,
    body: unknown,
    userAction: boolean,
  ): Promise<{ ok: true; value: unknown } | { ok: false; code: string }>;
  crossplayWire(bytes: number[]): Promise<void>;
  receiveCrossplayFrame?(data: ArrayBuffer): void;
}

async function installWebRtcSimulation(
  page: Page,
  address: string,
  port: number,
) {
  await page.addInitScript(
    ({ address, port }) => {
      const bridge = window as unknown as SimulationBridge;
      class Channel {
        binaryType = "arraybuffer";
        bufferedAmount = 0;
        readyState = "connecting";
        onmessage?: (event: { data: ArrayBuffer }) => void;
        onopen?: () => void;
        onclose?: () => void;

        send(payload: Uint8Array | ArrayBuffer) {
          const bytes = new Uint8Array(payload);
          void bridge
            .crossplayWire(Array.from(bytes))
            .catch(() => this.close());
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

        constructor(config: RTCConfiguration) {
          if (
            config.iceTransportPolicy !== "relay" ||
            !config.iceServers?.length
          )
            throw Error("Expected configured TURN and relay-only connection");
        }

        createDataChannel(label: string, config: RTCDataChannelInit) {
          if (
            label !== "electrify-coop-v2" ||
            !config.negotiated ||
            !config.ordered
          )
            throw Error("Expected the ordered negotiated co-op channel");
          const channel = new Channel();
          bridge.receiveCrossplayFrame = (data) => {
            if (channel.readyState !== "closed") channel.onmessage?.({ data });
          };
          this.channel = channel;
          return channel;
        }

        description(type: RTCSdpType): RTCSessionDescriptionInit {
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
                `a=candidate:fixture 1 udp 1 ${address} ${port} typ relay`,
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
          this.connect();
        }

        connect() {
          if (
            !this.localDescription ||
            !this.remoteDescription ||
            !this.channel
          )
            return;
          this.channel.readyState = "open";
          this.connectionState = "connected";
          this.channel.onopen?.();
          this.onconnectionstatechange?.();
        }

        async getStats() {
          const remote = /a=candidate:\S+ 1 udp \d+ (\S+) (\d+) typ relay/.exec(
            this.remoteDescription?.sdp ?? "",
          );
          return new Map<string, object>([
            [
              "transport",
              { type: "transport", selectedCandidatePairId: "pair" },
            ],
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
                port,
              },
            ],
            [
              "remote",
              {
                type: "remote-candidate",
                candidateType: "relay",
                address: remote?.[1],
                port: Number(remote?.[2]),
              },
            ],
          ]);
        }

        close() {
          this.connectionState = "closed";
          this.channel?.close();
        }
      }

      Object.defineProperty(window, "RTCPeerConnection", {
        configurable: true,
        value: PeerConnection,
      });
    },
    { address, port },
  );
}

/** Drive the real UI, workers and room API. Only platform proof, provider signaling,
 * Storage, Firestore and the browser's WebRTC implementation are test doubles. */
export function crossplayFixture() {
  const {
    createCrossplay,
  } = require("../firebase/functions/crossplay-http.cjs");
  const {
    CrossplayError,
  } = require("../firebase/functions/crossplay-errors.cjs");
  const rooms = new Map<string, Room>();
  const accounts = new Map<string, Account>();
  const acceptedGoogleProofs = new Map<string, string>();
  const signals = new Map<string, Signal>();
  const snapshots = new Map<string, RequestData>();
  const transfers = new Map<string, RequestData>();
  const operations: { operation: string }[] = [];
  const pages: Page[] = [];
  const wireQueue = new Map<Page, Promise<unknown>>();
  let linkLost = false;
  const currentRoom = (id: string) => ({
    room: structuredClone(rooms.get(id) ?? null),
    snapshot: rooms.get(id),
    now: Date.now(),
  });

  const service = createCrossplay({
    origins: [fakeOrigin],
    quotaKey: "playwright-crossplay-fixture-only",
    verifyGoogle: async (token: string) => ({
      uid: acceptedGoogleProofs.get(token),
      firebase: { sign_in_provider: "google.com" },
    }),
    verifySteam: async (ticket: string) =>
      ticket === desktopTicket ? "76561198000000000" : undefined,
    store: {
      account: async (id: string) => accounts.get(id),
      accounts: async (ids: string[]) => ids.map((id) => accounts.get(id)),
      consume: async () => true,
      consumeTicket: async () => true,
      issue: async (id: string, account: Account) => {
        accounts.set(id, account);
        return account.binding;
      },
      revoke: async (id: string) => {
        accounts.delete(id);
      },
      reserveRoom: async () => true,
      getRoom: async (id: string) => currentRoom(id),
      findInvite: async (digest: string) => {
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
      ) => {
        if (
          accounts.get(actor.account)?.tokenHash !== actor.tokenHash ||
          rooms.get(room.id) !== (version ?? undefined)
        )
          return false;
        rooms.set(room.id, structuredClone(room));
        return true;
      },
    },
    extensions: {
      signal: (
        operation: string,
        { room, seatId }: { room: Room; seatId: string },
        body: RequestData,
      ) => {
        const other = room.members.find(
          ({ id, active }) => id !== seatId && active,
        );
        const active = room.members.filter(({ active }) => active).length === 2;
        if (!active || !other) {
          if (operation === "signal/read") return { pairs: [] };
          throw new CrossplayError(409, "authority_changed");
        }
        let signal = signals.get(room.id);
        if (!signal || signal.epoch !== room.epoch) {
          signal = { epoch: room.epoch, generation: randomUUID() };
          signals.set(room.id, signal);
        }
        if (operation === "signal/read")
          return {
            pairs: [{ peerId: other.id, ...signal, remainingMs: 120_000 }],
          };
        if (body.generation !== signal.generation)
          throw new CrossplayError(409, "authority_changed");
        if (operation === "signal/turn")
          return {
            iceServers: [
              {
                urls: [
                  "turn:turn.cloudflare.com:3478",
                  "turns:turn.cloudflare.com:443",
                ],
                username: "fixture",
                credential: "fixture",
              },
            ],
            remainingMs: 120_000,
          };
        if (operation === "signal/reset") {
          signals.delete(room.id);
          return {};
        }
        const description = body.description as RTCSessionDescriptionInit;
        if (description.type === "offer" && seatId === room.hostId)
          signal.offer = description;
        else if (description.type === "answer" && seatId !== room.hostId)
          signal.answer = description;
        else throw new CrossplayError(400, "invalid_description");
        return {};
      },
      save: async (
        operation: string,
        context: {
          room: Room;
          updateRoom(
            update: (room: Room) => { room: Room; value: Checkpoint },
            guard: string,
          ): Promise<Checkpoint>;
        },
        body: RequestData,
      ) => {
        if (operation === "save/publish") {
          const head = await context.updateRoom((room) => {
            const head = {
              savedAt: Date.now(),
              epoch: room.epoch,
              name: String(body.name || "Campaign"),
              revision: 1,
              matchId: randomUUID(),
              schema: 3,
            };
            return { room: { ...room, head }, value: head };
          }, "host");
          snapshots.set(context.room.id, {
            content: body.content,
            digest: body.digest,
          });
          return head;
        }
        return snapshots.get(context.room.id);
      },
      transfer: (
        operation: string,
        { roomId }: { roomId: string },
        body: RequestData,
      ) => {
        if (operation === "transfer/put") {
          const reference = randomUUID();
          transfers.set(roomId + reference, {
            content: body.content,
            digest: body.digest,
          });
          return { reference };
        }
        return transfers.get(roomId + body.reference);
      },
    },
  });

  async function request(
    operation: string,
    body: unknown,
    bearer?: string,
    origin?: string,
  ) {
    operations.push({ operation });
    const result = { status: 500, body: {} as RequestData };
    const headers: Record<string, string | undefined> = {
      origin,
      authorization: bearer,
      "content-type": "application/json",
    };
    if (linkLost && operation === "room/state")
      return { status: 503, body: { error: "unavailable" } };
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
    return result;
  }

  return {
    operations,
    loseAuthority() {
      linkLost = true;
    },
    async install(page: Page, platform: "web" | "steam") {
      const index = pages.push(page);
      await page.exposeBinding("crossplayWire", async (_, data: number[]) => {
        const recipient = pages.find((candidate) => candidate !== page);
        if (!recipient || recipient.isClosed()) return;
        const send = (wireQueue.get(page) ?? Promise.resolve()).then(() =>
          recipient.evaluate((bytes) => {
            (window as unknown as SimulationBridge).receiveCrossplayFrame?.(
              Uint8Array.from(bytes).buffer,
            );
          }, data),
        );
        wireQueue.set(
          page,
          send.catch(() => {}),
        );
        await send;
      });
      await installWebRtcSimulation(page, relayAddress, 24000 + index);
      if (platform === "steam") {
        let auth: string | undefined;
        await page.exposeBinding(
          "crossplayInvoke",
          async (_, operation: string, body: unknown, userAction: boolean) => {
            if (!auth) {
              if (!userAction) return { ok: false, code: "unauthenticated" };
              const proof = await request("auth/steam", {
                ticket: desktopTicket,
                device: "s".repeat(43),
              });
              if (proof.status !== 200)
                return { ok: false, code: proof.body.error };
              auth = "Bearer " + proof.body.token;
            }
            const reply = await request(operation, body, auth);
            return reply.status === 200
              ? { ok: true, value: reply.body }
              : { ok: false, code: reply.body.error };
          },
        );
        await installSteamBridge(page, true);
      } else {
        const uid = "web-engineer-" + index;
        const token = await installGoogleProof(page, "Web Engineer", uid);
        acceptedGoogleProofs.set(token, uid);
        await page.route(api + "**", async (route) => {
          const incoming = route.request();
          const operation = incoming.url().slice(api.length);
          const reply = await request(
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
