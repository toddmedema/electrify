import type { SessionServices } from "./SessionTransport";
import { steamSessionServices } from "./SteamSessionServices";
import { facilityConstructionReview } from "../helpers/FacilityConstructionReview";
import "../Store";
import { TextEncoder } from "util";
import { webcrypto } from "crypto";
import { ReplicaRuntime } from "./ReplicaRuntime";
import type { ReplicaRequest, ReplicaResponse } from "./ReplicaProtocol";
import type { ReplicaBaseline } from "./Replication";
import { ReplicatedWorld } from "./Replication";
import { applyCommand, createWorld } from "./World";
import { loadSimData } from "../testing/SimData";
import { modScenario } from "../mods/ModScenario";
import { modBrowseSummary } from "./ModBrowse";
import { selectionKey, validBrowseState } from "./Browse";
import { utf8Bytes } from "../helpers/RuleIdentity";
import {
  CONNECTION_LOST,
  HOST_LEFT,
  MultiplayerSession,
  isConnectionLoss,
} from "./Session";
import type { DesktopBridge } from "../Desktop";
import type {
  LobbyState,
  NativeEvent,
  NativeRequest,
  PendingCampaign,
} from "./Native";
import type { RoomView, World } from "./Types";
import type { BrowseState } from "./Browse";
import type { WorkerRequest, WorkerResponse } from "./WorkerProtocol";
import { COOP_TEST_SPEC } from "../testing/MultiplayerFixtures";
import { DEFAULT_CUSTOM_SCENARIO } from "../data/Scenarios";
import { coopSelection } from "./Choosing";
import { getBuildFacilityQuote } from "../data/Facilities";
import { UTILITY_AREAS } from "../data/UtilityExpansion";
import { availableTerritoryTiles } from "../helpers/TerritoryTiles";
import { currentTick } from "../helpers/GameSelectors";
import { SESSION_PUMP_MS } from "./Timing";

const host = "host",
  guest = "guest";
const view = (update: Partial<RoomView> = {}): RoomView => ({
  matchId: "match",
  epoch: "epoch",
  revision: 1,
  speed: "PAUSED",
  readyRequired: true,
  reason: "Ready?",
  disconnected: [],
  ready: [],
  lastSequence: 0,
  grids: [],
  ...update,
});
function fixture(
  isHost = false,
  deferLeave = false,
  overrides: Partial<SessionServices> = {},
) {
  let event: (event: NativeEvent) => void = () => {};
  const requests: NativeRequest[] = [],
    posts: WorkerRequest[] = [];
  const selfId = isHost ? host : guest;
  const worker = {
    onmessage: null as ((event: MessageEvent<WorkerResponse>) => void) | null,
    onerror: null as ((event: Event) => void) | null,
    terminate: jest.fn(),
    postMessage: (request: WorkerRequest) => {
      posts.push(request);
      if (
        (request.kind === "create" || request.kind === "restore") &&
        !delayStart
      )
        worker.onmessage?.({
          data: { kind: "views", views: { [host]: view() } },
        } as unknown as MessageEvent<WorkerResponse>);
      if (request.kind === "checkpoint")
        worker.onmessage?.({
          data: {
            kind: "checkpoint",
            world: {} as World,
            requestId: request.requestId,
          },
        } as unknown as MessageEvent<WorkerResponse>);
    },
  };
  let delayStart = false,
    failLock = false,
    failFactory = false,
    failSave = false,
    failLeave = false,
    failReconnect = false,
    sendError: string | undefined;
  let releaseLeave = () => {};
  let checkpoint: World | null = null;
  let readGate = Promise.resolve();
  let releaseRead = () => {};
  const bridge = {
    onMultiplayerEvent: (callback: typeof event) => {
      event = callback;
      return () => {};
    },
    multiplayerRequest: async (request: NativeRequest) => {
      requests.push(request);
      if (request.kind === "read-checkpoint") {
        await readGate;
        return checkpoint;
      }
      if (request.kind === "create" || request.kind === "join")
        return {
          available: true,
          selfId,
          hostId: selfId,
          lobbyId: "new-lobby",
          members: [{ id: selfId, name: "Host" }],
          connected: [],
        };
      if (request.kind === "member")
        return {
          ...session.getSnapshot().lobby,
          members: session
            .getSnapshot()
            .lobby.members.map((member) =>
              member.id === selfId
                ? { ...member, [request.key]: request.value }
                : member,
            ),
        };
      // What Electron's invoke rejects with when the main process throws.
      if (request.kind === "send" && sendError)
        throw new Error(
          `Error invoking remote method 'desktop:multiplayer': Error: ${sendError}`,
        );
      if (request.kind === "lock" && failLock) throw new Error("Lock failed");
      if (request.kind === "leave" && deferLeave)
        await new Promise<void>((resolve) => {
          releaseLeave = resolve;
        });
      if (request.kind === "checkpoint" && failSave)
        throw new Error("Disk full");
      if (request.kind === "leave" && failLeave)
        throw new Error("Steam unavailable");
      if (request.kind === "reconnect" && failReconnect)
        throw new Error("Steam could not connect to the host");
      if (request.kind === "state")
        return {
          available: true,
          selfId,
          hostId: host,
          lobbyId: "lobby",
          members: [
            { id: host, name: "Host" },
            { id: guest, name: "Guest" },
          ],
          connected: [isHost ? guest : host],
        };
    },
  } as unknown as DesktopBridge;
  let projection: RoomView | undefined;
  let replicaIdentity = "";
  const replicaPosts: ReplicaRequest[] = [];
  const replica = {
    onerror: null as ((event: Event) => void) | null,
    onmessage: null as ((event: MessageEvent<ReplicaResponse>) => void) | null,
    terminate: jest.fn(() => {
      replicaIdentity = "";
    }),
    postMessage(request: ReplicaRequest) {
      replicaPosts.push(request);
      if (request.kind === "baseline" && projection) {
        const current = projection;
        projection = undefined;
        replicaIdentity = `${current.matchId}/${current.epoch}`;
        respond({
          kind: "progress",
          matchId: current.matchId,
          epoch: current.epoch,
          applied: 0,
          state: "live",
        });
        membership(current);
        respond({ kind: "views", views: { [guest]: current } });
      } else if (request.kind !== "views-applied" || useRuntime)
        void runtime.receive(request);
    },
  };
  let useRuntime = false;
  const respond = (data: ReplicaResponse) =>
    replica.onmessage?.({ data } as MessageEvent<ReplicaResponse>);
  const membership = (current: RoomView) => {
    if (
      current.disconnected.length ||
      session.getSnapshot().view?.disconnected.length
    )
      event({
        kind: "message",
        sender: host,
        payload: {
          kind: "keepalive",
          matchId: current.matchId,
          epoch: current.epoch,
          revision: current.revision,
          disconnected: current.disconnected,
        },
      });
  };
  const runtime = new ReplicaRuntime(
    respond,
    async () => {},
    undefined,
    (bytes) => webcrypto.subtle.digest("SHA-256", bytes),
  );
  const session = new MultiplayerSession(
    { ...steamSessionServices(bridge), ...overrides },
    async () => {
      if (failFactory) throw new Error("Factory failed");
      return worker as unknown as Worker;
    },
    async () => replica as unknown as Worker,
  );
  return {
    session,
    bridge,
    worker,
    requests,
    posts,
    replicaPosts,
    baseline: async (baseline: ReplicaBaseline) => {
      useRuntime = true;
      event({
        kind: "message",
        sender: host,
        payload: { kind: "baseline", ...baseline },
      });
      await flushReplica();
      jest.advanceTimersByTime(0);
      await flushReplica();
    },
    project: async (current: RoomView) => {
      if (replicaIdentity !== `${current.matchId}/${current.epoch}`) {
        projection = current;
        event({
          kind: "message",
          sender: host,
          payload: {
            kind: "baseline",
            matchId: current.matchId,
            epoch: current.epoch,
            index: 0,
            blockers: [],
            world: { spec: COOP_TEST_SPEC } as World,
          },
        });
        await flushReplica();
      } else {
        membership(current);
        respond({ kind: "views", views: { [guest]: current } });
      }
    },
    event: (value: NativeEvent) => event(value),
    releaseLeave: () => releaseLeave(),
    checkpoint: (value: World | null, hold = false) => {
      checkpoint = value;
      if (hold)
        readGate = new Promise<void>((resolve) => {
          releaseRead = resolve;
        });
    },
    releaseRead: () => releaseRead(),
    fail: () => {
      failSave = true;
    },
    failLeave: () => {
      failLeave = true;
    },
    failReconnect: () => {
      failReconnect = true;
    },
    failReplica: () => replica.onerror?.(new Event("error")),
    /** Every native send fails the way Electron reports a main-process throw. */
    failSends: (message: string | undefined) => {
      sendError = message;
    },
    startup: (failure?: "lock" | "factory" | "delayed") => {
      failLock = failure === "lock";
      failFactory = failure === "factory";
      delayStart = failure === "delayed";
    },
  };
}
const flushReplica = async () => {
  for (let n = 0; n < 30; n++) await Promise.resolve();
};
Object.assign(globalThis, { TextEncoder });
beforeAll(() => loadSimData("SF"));
beforeEach(() => {
  jest.useFakeTimers();
  let id = 0;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { randomUUID: () => `id-${++id}` },
  });
});
afterEach(() => jest.useRealTimers());

const campaign: PendingCampaign = {
  id: "campaign-id",
  name: "Friends campaign",
  players: [
    { id: host, name: "Host" },
    { id: guest, name: "Guest" },
    { id: "retired", name: "Retired" },
  ],
  requiredPlayerIds: [host, guest],
};
const savedCampaign = () =>
  ({
    seats: campaign.players,
    outcomes: { retired: { outcome: "completed" } },
  }) as unknown as World;

test("first player to claim a logo keeps it until releasing it or leaving", async () => {
  const f = fixture(true);
  await f.session.initialize();
  const pick = (sender: string, logo: "sunburst" | null) =>
    f.event({
      kind: "message",
      sender,
      payload: { kind: "utility-logo-pick", logo, requestId: "pick-logo" },
    });
  pick("spectator", "sunburst");
  expect(f.session.getSnapshot().utilityLogos).toBeUndefined();

  pick(guest, "sunburst");
  await f.session.selectUtilityLogo("sunburst");
  expect(f.session.getSnapshot()).toMatchObject({
    utilityLogos: { [guest]: "sunburst" },
    utilityLogoError: "That logo is already taken.",
  });
  pick(guest, null);
  expect(f.session.getSnapshot().utilityLogos).toEqual({});
  await f.session.selectUtilityLogo("sunburst");
  pick(guest, "sunburst");
  expect(f.requests.at(-1)).toMatchObject({
    kind: "send",
    to: guest,
    payload: {
      kind: "utility-logo-claims",
      claims: { [host]: "sunburst" },
      reply: { requestId: "pick-logo", error: "taken" },
    },
  });

  await f.session.selectUtilityLogo(null);
  pick(guest, "sunburst");
  const lobby = f.session.getSnapshot().lobby;
  f.event({ kind: "state", state: { ...lobby, connected: [] } });
  expect(f.session.getSnapshot().utilityLogos).toEqual({ [guest]: "sunburst" });
  f.event({
    kind: "state",
    state: {
      ...lobby,
      connected: [],
      members: lobby.members.filter(({ id }) => id !== guest),
    },
  });
  expect(f.session.getSnapshot().utilityLogos).toEqual({});
});

test("guests wait for the host to acknowledge their logo before marking Ready", async () => {
  const f = fixture();
  await f.session.initialize();
  const selectedScenario = browse();
  sendBrowse(f, selectedScenario);
  const ready = selectionKey(selectedScenario);
  await f.session.selectUtilityLogo("sunburst");
  const { utilityLogoRequest: requestId } = f.session.getSnapshot();
  expect(requestId).toBeTruthy();
  await expect(f.session.setReady(ready)).rejects.toThrow(
    "Waiting for the host",
  );
  expect(f.requests.at(-1)).toEqual({
    kind: "send",
    to: host,
    payload: { kind: "utility-logo-pick", logo: "sunburst", requestId },
  });
  const payload = {
    kind: "utility-logo-claims",
    claims: { [guest]: "sunburst" },
    reply: { requestId: requestId! },
  } as const;
  f.event({ kind: "message", sender: "other", payload });
  expect(f.session.getSnapshot().utilityLogos).toBeUndefined();
  f.event({
    kind: "message",
    sender: host,
    payload: { ...payload, reply: undefined },
  });
  expect(f.session.getSnapshot().utilityLogoRequest).toBe(requestId);
  f.event({ kind: "message", sender: host, payload });
  expect(f.session.getSnapshot().utilityLogoRequest).toBeUndefined();
  await f.session.setReady(ready);
  await f.session.selectUtilityLogo(null);
  expect(f.requests.at(-1)).toMatchObject({
    kind: "member",
    key: "ready",
    value: ready,
  });
  expect(coopSelection(f.session.getSnapshot()).utilityLogos).toEqual(
    payload.claims,
  );
});

test("the host sends claimed company logos to the game worker", async () => {
  const f = fixture(true);
  await f.session.initialize();
  await f.session.selectUtilityLogo("sunburst");
  f.event({
    kind: "message",
    sender: guest,
    payload: {
      kind: "utility-logo-pick",
      logo: "grid-pylon",
      requestId: "pick-logo",
    },
  });
  await f.session.start({ spec: COOP_TEST_SPEC });
  expect(f.posts.find(({ kind }) => kind === "create")).toMatchObject({
    seats: [
      { id: host, utilityLogo: "sunburst" },
      { id: guest, utilityLogo: "grid-pylon" },
    ],
  });
});

test("the host rejects logo edits from an already-ready guest", async () => {
  const f = fixture(true);
  await f.session.initialize();
  const { session } = f;
  session.publishBrowse({
    phase: "browsing",
    card: "NEW_GAME",
    difficulty: "Employee",
  });
  const lobby = session.getSnapshot().lobby;
  f.event({
    kind: "state",
    state: {
      ...lobby,
      members: lobby.members.map((member) =>
        member.id === guest
          ? { ...member, ready: selectionKey(session.getSnapshot().browse!) }
          : member,
      ),
    },
  });
  f.event({
    kind: "message",
    sender: guest,
    payload: {
      kind: "utility-logo-pick",
      logo: "sunburst",
      requestId: "late-pick",
    },
  });
  expect(session.getSnapshot().utilityLogos).toBeUndefined();
  expect(f.requests.at(-1)).toMatchObject({
    kind: "send",
    to: guest,
    payload: {
      kind: "utility-logo-claims",
      claims: {},
      reply: { requestId: "late-pick", error: "locked" },
    },
  });
});

test("an invite received during startup supersedes an older launch invite", async () => {
  const f = fixture();
  const initial = {
    available: true,
    selfId: guest,
    members: [],
    connected: [],
    inviteLobbyId: "older-invite",
  };
  const state = Promise.withResolvers<LobbyState>();
  jest.spyOn(f.bridge, "multiplayerRequest").mockReturnValueOnce(state.promise);
  const accept = jest.fn();
  const initialized = f.session.initialize(accept);
  f.event({ kind: "invite", lobbyId: "new-invite" });
  expect(accept).not.toHaveBeenCalled();
  state.resolve(initial);
  await initialized;
  expect(accept.mock.calls).toEqual([["new-invite"]]);
  f.session.dispose();
});

test("an accepted invitation waits for lobby creation to finish before joining", async () => {
  const f = fixture(true);
  const idle = { available: true, selfId: host, members: [], connected: [] };
  const creating = Promise.withResolvers<LobbyState>();
  const joined = { ...idle, lobbyId: "invited-lobby", hostId: guest };
  const requests = jest
    .spyOn(f.bridge, "multiplayerRequest")
    .mockImplementation((request) => {
      if (request.kind === "create") return creating.promise;
      return Promise.resolve(request.kind === "join" ? joined : idle);
    });
  const accept = jest.fn((id: string) => f.session.join(id));
  await f.session.initialize(accept);
  const hosted = f.session.create();
  f.event({ kind: "invite", lobbyId: "invited-lobby" });
  jest.advanceTimersByTime(SESSION_PUMP_MS);
  expect(accept).not.toHaveBeenCalled();
  creating.resolve({ ...idle, lobbyId: "hosted-lobby", hostId: host });
  await hosted;
  expect(f.session.getSnapshot().lobby.lobbyId).toBe("hosted-lobby");
  jest.advanceTimersByTime(SESSION_PUMP_MS);
  await accept.mock.results[0].value;
  expect(requests.mock.calls.map(([request]) => request.kind)).toEqual([
    "state",
    "create",
    "join",
  ]);
  expect(f.session.getSnapshot().lobby.lobbyId).toBe("invited-lobby");
  f.session.dispose();
});

test("switching rooms ignores late state, messages and disconnects from the old lobby", async () => {
  const f = fixture();
  await f.session.initialize();
  const oldLobby = f.session.getSnapshot().lobby;
  const joined = Promise.withResolvers<LobbyState>();
  const request = jest
    .spyOn(f.bridge, "multiplayerRequest")
    .mockReturnValueOnce(joined.promise);
  const joining = f.session.join("new-lobby");
  f.event({ kind: "state", state: oldLobby });
  f.event({
    kind: "message",
    sender: host,
    payload: {
      kind: "browse",
      browse: browse({ session: "old-session" }),
    },
  });
  f.event({ kind: "disconnected", sender: host });
  expect(f.session.getSnapshot().browse).toBeUndefined();
  const newLobby = {
    ...oldLobby,
    lobbyId: "new-lobby",
    hostId: "other-host",
    members: [{ id: "other-host", name: "New host" }],
  };
  f.event({ kind: "state", state: newLobby });
  f.event({ kind: "state", state: oldLobby });
  f.event({
    kind: "message",
    sender: "other-host",
    payload: { kind: "browse", browse: browse({ session: "new-session" }) },
  });
  joined.resolve(newLobby);
  await joining;
  expect(f.session.getSnapshot().lobby.lobbyId).toBe("new-lobby");
  expect(f.session.getSnapshot().browse?.session).toBe("new-session");
  expect(request.mock.calls.map(([input]) => input.kind)).toEqual(["join"]);
  f.session.dispose();
});

test("a new host disconnecting during join sends the guest back after the join settles", async () => {
  const f = fixture();
  await f.session.initialize();
  const { selfId } = f.session.getSnapshot().lobby;
  const newLobby: LobbyState = {
    available: true,
    selfId,
    lobbyId: "new-lobby",
    hostId: "other-host",
    members: [{ id: "other-host", name: "New host" }],
    connected: [],
  };
  const joined = Promise.withResolvers<LobbyState>();
  const request = jest
    .spyOn(f.bridge, "multiplayerRequest")
    .mockReturnValueOnce(joined.promise);
  const joining = f.session.join("new-lobby");
  f.event({ kind: "state", state: newLobby });
  f.event({ kind: "disconnected", sender: "other-host" });
  expect(request.mock.calls.map(([input]) => input.kind)).toEqual(["join"]);
  joined.resolve(newLobby);
  await joining;
  await flushReplica();
  expect(request.mock.calls.map(([input]) => input.kind)).toEqual([
    "join",
    "leave",
  ]);
  expect(f.session.getSnapshot().lobby.lobbyId).toBeUndefined();
  expect(f.session.getSnapshot().error).toBe(HOST_LEFT);
  f.session.dispose();
});

test("resuming a campaign creates its invitation lobby before starting and waits for its saved players", async () => {
  const f = fixture(true);
  await f.session.initialize();
  f.event({
    kind: "state",
    state: { available: true, selfId: host, members: [], connected: [] },
  });
  f.checkpoint(savedCampaign());
  await f.session.prepareResume(campaign.id, campaign.name);
  expect(f.session.getSnapshot().pendingCampaign).toEqual(campaign);
  expect(f.session.getSnapshot().lobby.lobbyId).toBe("new-lobby");
  expect(f.requests.some((r) => r.kind === "create")).toBe(true);
  expect(f.requests.some((r) => r.kind === "lock")).toBe(false);
  expect(f.posts).toEqual([]);
  expect(f.session.canResumeCampaign()).toBe(false);
  const lobby = {
    ...f.session.getSnapshot().lobby,
    members: campaign.players.slice(0, 2),
    connected: [guest],
  };
  f.event({ kind: "state", state: lobby });
  expect(f.session.canResumeCampaign()).toBe(true);
  expect(f.requests.at(-1)).toMatchObject({
    kind: "send",
    to: guest,
    payload: { kind: "campaign", campaign },
  });
  f.event({
    kind: "state",
    state: {
      ...lobby,
      members: [...lobby.members, { id: "other", name: "Other" }],
    },
  });
  expect(f.session.canResumeCampaign()).toBe(false);
  await expect(
    f.session.start({ saved: true, id: campaign.id }),
  ).rejects.toThrow(/Other must pick a company/);
  expect(f.session.getSnapshot().pendingCampaign).toEqual(campaign);
  f.event({ kind: "state", state: lobby });
  await f.session.start({ saved: true, id: campaign.id });
  expect(f.requests).toContainEqual({
    kind: "lock",
    ids: [host, guest, "retired"],
    requiredIds: [host, guest],
  });
  expect(
    f.posts.findLast((request) => request.kind === "restore"),
  ).toMatchObject({
    kind: "restore",
    seats: campaign.players,
  });
  expect(f.session.getSnapshot().pendingCampaign).toBeUndefined();
  f.session.dispose();
});

test("a friend who was not in the save claims an open company and resumes it", async () => {
  const f = fixture(true);
  await f.session.initialize();
  f.checkpoint(savedCampaign());
  await f.session.prepareResume(campaign.id, campaign.name);
  await f.session.claimSlot(guest);
  expect(f.requests.at(-1)).toEqual({
    kind: "member",
    key: "slot",
    value: `${campaign.id}:${guest}`,
  });
  const lobby = (members: LobbyState["members"], connected: string[]) =>
    f.event({
      kind: "state",
      state: {
        ...f.session.getSnapshot().lobby,
        lobbyId: "lobby",
        hostId: host,
        selfId: host,
        members,
        connected,
      },
    });
  // A newcomer joins before anyone has taken the absent guest's company.
  lobby(
    [
      { id: host, name: "Host" },
      { id: "friend", name: "Friend" },
    ],
    ["friend"],
  );
  expect(f.session.resumeBlocker()).toBe("Friend must pick a company");
  lobby(
    [
      { id: host, name: "Host" },
      { id: "friend", name: "Friend", slot: `${campaign.id}:${guest}` },
    ],
    [],
  );
  expect(f.session.resumeBlocker()).toBe("Every player must be connected");
  lobby(
    [
      { id: host, name: "Host" },
      { id: "friend", name: "Friend", slot: `${campaign.id}:${guest}` },
    ],
    ["friend"],
  );
  expect(f.session.canResumeCampaign()).toBe(true);
  await f.session.start({ saved: true, id: campaign.id });
  expect(f.requests).toContainEqual({
    kind: "lock",
    ids: [host, "friend", "retired"],
    requiredIds: [host, "friend"],
  });
  expect(
    f.posts.findLast((request) => request.kind === "restore"),
  ).toMatchObject({
    kind: "restore",
    seats: [
      { id: host, name: "Host" },
      { id: "friend", name: "Friend" },
      { id: "retired", name: "Retired" },
    ],
  });
  f.session.dispose();
});

test("friends leaving before the match begins are routine, and a guest whose host leaves goes home", async () => {
  const f = fixture(true);
  await f.session.initialize();
  f.event({ kind: "disconnected", sender: guest });
  expect(f.session.getSnapshot().error).toBeUndefined();
  f.session.dispose();
  const g = fixture();
  await g.session.initialize();
  g.event({
    kind: "state",
    state: {
      ...g.session.getSnapshot().lobby,
      members: [{ id: guest, name: "Guest" }],
      connected: [],
    },
  });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(g.requests.some((r) => r.kind === "leave")).toBe(true);
  expect(g.session.getSnapshot().lobby.lobbyId).toBeUndefined();
  expect(g.session.getSnapshot().error).toBe(HOST_LEFT);
  g.session.dispose();
});

test("a missing campaign does not create a lobby", async () => {
  const f = fixture(true);
  await f.session.initialize();
  f.event({
    kind: "state",
    state: { available: true, selfId: host, members: [], connected: [] },
  });
  await expect(
    f.session.prepareResume(campaign.id, campaign.name),
  ).rejects.toThrow(/could not be found/);
  expect(f.requests.some((r) => r.kind === "create")).toBe(false);
  expect(f.session.getSnapshot().busy).toBe(false);
  expect(f.session.getSnapshot().pendingCampaign).toBeUndefined();
  f.session.dispose();
});

test("campaign resume retains bounded player names through 200 characters and gives unnamed players an identity label", async () => {
  const f = fixture(true);
  await f.session.initialize();
  const players = [
    { id: host, name: "界".repeat(200) },
    { id: guest, name: undefined },
    { id: "retired", name: " " },
  ];
  f.checkpoint({ ...savedCampaign(), seats: players } as unknown as World);
  await f.session.prepareResume(campaign.id, campaign.name);
  expect(f.session.getSnapshot().pendingCampaign?.players).toEqual([
    players[0],
    { id: guest, name: guest },
    { id: "retired", name: "retired" },
  ]);
  f.checkpoint({
    ...savedCampaign(),
    seats: [{ id: host, name: "界".repeat(201) }, campaign.players[1]],
  });
  await expect(
    f.session.prepareResume(campaign.id, campaign.name),
  ).rejects.toThrow(/could not be read/);
  expect(f.session.getSnapshot().pendingCampaign?.players[0].name).toBe(
    players[0].name,
  );
  f.session.dispose();
});

test("deleting the staged campaign clears its invitation for every player while another deletion keeps it", async () => {
  const f = fixture(true);
  await f.session.initialize();
  f.checkpoint(savedCampaign());
  await f.session.prepareResume(campaign.id, campaign.name);
  await f.session.deleteSharedSave("another-campaign");
  expect(f.session.getSnapshot().pendingCampaign).toEqual(campaign);
  await f.session.deleteSharedSave(campaign.id);
  expect(f.session.getSnapshot().pendingCampaign).toBeUndefined();
  expect(f.session.canResumeCampaign()).toBe(false);
  expect(f.requests.at(-1)).toEqual({
    kind: "send",
    to: guest,
    payload: { kind: "campaign", campaign: undefined },
  });
  f.session.dispose();
});

test("leaving while a campaign loads cannot create a late invitation lobby", async () => {
  const f = fixture(true);
  await f.session.initialize();
  f.checkpoint(savedCampaign(), true);
  const preparing = f.session.prepareResume(campaign.id, campaign.name);
  await f.session.leave({ skipSave: true });
  f.releaseRead();
  await preparing;
  expect(f.requests.some((r) => r.kind === "create")).toBe(false);
  expect(f.session.getSnapshot().pendingCampaign).toBeUndefined();
  expect(f.session.getSnapshot().lobby.lobbyId).toBeUndefined();
  f.session.dispose();
});

test("a guest accepts only a valid saved-campaign roster from its host and follows later new-game choices", async () => {
  const f = fixture();
  await f.session.initialize();
  const send = (sender: string, value: PendingCampaign) =>
    f.event({
      kind: "message",
      sender,
      payload: { kind: "campaign", campaign: value },
    });
  send("stranger", campaign);
  send(host, { ...campaign, requiredPlayerIds: ["stranger"] });
  send(host, {
    ...campaign,
    players: [campaign.players[0], campaign.players[0]],
  });
  expect(f.session.getSnapshot().pendingCampaign).toBeUndefined();
  send(host, campaign);
  expect(f.session.getSnapshot().pendingCampaign).toEqual(campaign);
  expect(f.session.canResumeCampaign()).toBe(false);
  f.event({ kind: "message", sender: host, payload: { kind: "campaign" } });
  expect(f.session.getSnapshot().pendingCampaign).toBeUndefined();
  send(host, campaign);
  f.event({
    kind: "message",
    sender: host,
    payload: { kind: "browse", browse: browse() },
  });
  expect(f.session.getSnapshot().pendingCampaign).toBeUndefined();
  f.session.dispose();
});

test("late host frames cannot restore a guest game during leave or before rejoining", async () => {
  const f = fixture(false, true);
  await f.session.initialize();
  const frame = (revision: number) => f.project(view({ revision }));
  await frame(1);
  // Skip the host save so the test holds the session inside the native lobby exit.
  const leaving = f.session.leave({ skipSave: true });
  await frame(2);
  expect(f.session.getSnapshot().view?.revision).toBe(1);
  f.releaseLeave();
  await leaving;
  expect(f.session.getSnapshot().lobby).toMatchObject({
    lobbyId: undefined,
    hostId: undefined,
    members: [],
    connected: [],
  });
  await frame(3);
  f.event({
    kind: "message",
    sender: host,
    payload: {
      kind: "keepalive",
      matchId: "match",
      epoch: "epoch",
      revision: 3,
    },
  });
  expect(f.session.getSnapshot().view).toBeUndefined();
  // The host's next lobby is unrelated until this guest explicitly rejoins it.
  f.event({
    kind: "state",
    state: { available: true, selfId: guest, members: [], connected: [] },
  });
  await frame(4);
  expect(f.session.getSnapshot().view).toBeUndefined();
  f.event({
    kind: "state",
    state: {
      available: true,
      selfId: guest,
      hostId: host,
      lobbyId: "restored-lobby",
      members: [
        { id: host, name: "Host" },
        { id: guest, name: "Guest" },
      ],
      connected: [host],
    },
  });
  await f.project(view({ revision: 5 }));
  expect(f.session.getSnapshot().view?.epoch).toBe("epoch");
  await f.project(view({ epoch: "restored", revision: 0 }));
  expect(f.session.getSnapshot().view?.epoch).toBe("restored");
  f.session.dispose();
});
test("retry retains the same purchase sequence, acknowledgements stop retry, and stale views cannot rewind", async () => {
  const f = fixture();
  await f.session.initialize();
  await f.project(view());
  f.session.command({
    kind: "action" as const,
    name: "buildFacility",
    payload: { facility: { name: "Wind", peakW: 50e6 }, financed: true },
  });
  jest.advanceTimersByTime(2000);
  const sends = f.requests.filter(
    (r) => r.kind === "send" && r.payload.kind === "command",
  );
  expect(sends).toHaveLength(2);
  expect(sends[0]).toEqual(sends[1]);
  await f.project(
    view({ revision: 2, lastSequence: 1, receipt: { sequence: 1 } }),
  );
  expect(f.session.getSnapshot().pending).toBe(false);
  await f.project(view());
  expect(f.session.getSnapshot().view?.revision).toBe(2);
  jest.advanceTimersByTime(2000);
  expect(
    f.requests.filter((r) => r.kind === "send" && r.payload.kind === "command"),
  ).toHaveLength(2);
  f.session.dispose();
});
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
const lobbyWith = (connected: string[]): NativeEvent => ({
  kind: "state",
  state: {
    available: true,
    selfId: guest,
    hostId: host,
    lobbyId: "lobby",
    members: [
      { id: host, name: "Host" },
      { id: guest, name: "Guest" },
    ],
    connected,
  },
});
test("a guest's command waits out a lost host link instead of raising an error on every retry", async () => {
  const f = fixture();
  await f.session.initialize();
  await deliver(f, {});
  f.event(lobbyWith([]));
  f.session.command({ kind: "speed", speed: "SLOW" });
  jest.advanceTimersByTime(10_000);
  await settle();
  expect(sentCommands(f)).toHaveLength(0);
  expect(f.session.getSnapshot().error).toBeUndefined();
  expect(f.session.getSnapshot().pending).toBe(true);
  // The same numbered command goes out as soon as the link returns, without the player acting.
  f.event(lobbyWith([host]));
  jest.advanceTimersByTime(1000);
  expect(sentCommands(f)).toEqual([{ kind: "speed", speed: "SLOW" }]);
  expect(f.session.getSnapshot().error).toBeUndefined();
  f.session.dispose();
});
test("a command that loses a race with the host link drops is not a new failure", async () => {
  const f = fixture();
  await f.session.initialize();
  await deliver(f, {});
  f.failSends("Player is disconnected");
  f.session.command({ kind: "speed", speed: "SLOW" });
  jest.advanceTimersByTime(5000);
  await settle();
  expect(f.session.getSnapshot().error).toBeUndefined();
  expect(f.session.getSnapshot().pending).toBe(true);
  f.session.dispose();
});
test("only a lost connection counts as one, so other errors never offer a way out that skips the save", async () => {
  const f = fixture();
  await f.session.initialize();
  await deliver(f, {});
  f.event({ kind: "disconnected", sender: host });
  expect(f.session.getSnapshot().error).toBe(CONNECTION_LOST);
  expect(isConnectionLoss(f.session.getSnapshot().error)).toBe(true);
  // Native lobby errors come only from its connection failures.
  expect(isConnectionLoss(undefined, "The host left.")).toBe(true);
  expect(isConnectionLoss("Multiplayer save failed: Disk full")).toBe(false);
  expect(isConnectionLoss("Multiplayer save failed: Disk full", "x")).toBe(
    false,
  );
  expect(isConnectionLoss("Not enough cash")).toBe(false);
  expect(isConnectionLoss()).toBe(false);
  f.session.dispose();
});
test("a host can leave the interruption only after a confirmed epoch replaces its hosted view", async () => {
  let authorityEpoch: string | undefined = "epoch";
  const f = fixture(true, false, {
    authority: () =>
      authorityEpoch
        ? {
            epoch: authorityEpoch,
            monotonicDeadline: Infinity,
            wallDeadline: Infinity,
          }
        : undefined,
  });
  await f.session.initialize();
  const lobby = { ...f.session.getSnapshot().lobby, authorityEpoch };
  f.event({ kind: "state", state: lobby });
  await f.session.start({ spec: COOP_TEST_SPEC });
  expect(f.posts).toContainEqual(
    expect.objectContaining({
      kind: "create",
      spec: { ...COOP_TEST_SPEC, territorialVersion: 2 },
    }),
  );
  expect(f.session.getSnapshot().view?.epoch).toBe("epoch");
  const checkpoint = {
    ...lobby,
    recoveryAvailable: true,
    confirmedRevision: 0,
  };

  authorityEpoch = undefined;
  f.event({ kind: "state", state: checkpoint });
  expect(f.session.canLeaveInterruption()).toBe(false);
  expect(f.worker.terminate).not.toHaveBeenCalled();

  authorityEpoch = "replacement";
  f.event({
    kind: "state",
    state: { ...checkpoint, authorityEpoch, confirmedRevision: undefined },
  });
  expect(f.worker.terminate).toHaveBeenCalled();
  expect(f.session.canLeaveInterruption()).toBe(false);

  f.event({ kind: "state", state: { ...checkpoint, authorityEpoch } });
  expect(f.session.getSnapshot().checkpointRecovery).toEqual({
    confirmedRevision: 0,
  });
  expect(f.session.canLeaveInterruption()).toBe(true);

  authorityEpoch = undefined;
  f.event({
    kind: "state",
    state: { ...checkpoint, authorityEpoch, recoveryAvailable: false },
  });
  expect(f.session.canLeaveInterruption()).toBe(true);
  await f.session.leave({ skipSave: true });
  expect(f.session.getSnapshot().checkpointRecovery).toBeUndefined();
  expect(f.session.canLeaveInterruption()).toBe(false);
  f.session.dispose();
});
test("players read the transport's message, never Electron's invoke wrapper", async () => {
  const f = fixture();
  await f.session.initialize();
  await deliver(f, {});
  f.failSends("Co-op connection is catching up");
  f.session.command({ kind: "speed", speed: "SLOW" });
  await settle();
  expect(f.session.getSnapshot().error).toBe("Co-op connection is catching up");
  f.session.dispose();
});
test("a fresh epoch discards the pending old purchase and starts command numbering again", async () => {
  const f = fixture();
  await f.session.initialize();
  await f.project(view());
  f.session.command({
    kind: "action" as const,
    name: "buildFacility",
    payload: { facility: { name: "Wind", peakW: 50e6 }, financed: true },
  });
  await f.project(view({ epoch: "restored", revision: 0 }));
  jest.advanceTimersByTime(2000);
  expect(
    f.requests.filter((r) => r.kind === "send" && r.payload.kind === "command"),
  ).toHaveLength(1);
  f.session.command({ kind: "ready" });
  const last = f.requests.at(-1);
  expect(
    last?.kind === "send" &&
      last.payload.kind === "command" &&
      last.payload.envelope,
  ).toMatchObject({ epoch: "restored", sequence: 1 });
  f.session.dispose();
});
test("a guest's ready while another player is away gets a refusal instead of hanging", async () => {
  const f = fixture(true);
  await f.session.initialize();
  await f.session.start({ spec: COOP_TEST_SPEC });
  f.worker.onmessage?.({
    data: {
      kind: "views",
      views: {
        [host]: view({
          grids: [host, guest, "away"].map((id) => ({
            seat: { id, name: id },
          })) as RoomView["grids"],
        }),
      },
    },
  } as unknown as MessageEvent<WorkerResponse>);
  const envelope = {
    matchId: "match",
    epoch: "epoch",
    sequence: 1,
    command: { kind: "ready" as const },
  };
  f.event({
    kind: "message",
    sender: guest,
    payload: { kind: "command", envelope },
  });
  expect(f.posts.at(-1)).toEqual({
    kind: "command",
    sender: guest,
    envelope,
    allowReady: false,
  });
  f.session.dispose();
});
test("the desktop exit checkpoint pauses the worker and propagates a failed disk write", async () => {
  const f = fixture(true);
  await f.session.initialize();
  await f.session.start({ spec: COOP_TEST_SPEC });
  f.fail();
  await expect(f.session.save(true)).rejects.toThrow("Disk full");
  expect(f.posts.at(-1)).toMatchObject({ kind: "checkpoint", pause: true });
  expect(f.session.getSnapshot().error).toMatch(/Disk full/);
  f.session.dispose();
});

const ownGrid = (pauseReason?: string) =>
  [
    {
      seat: { id: guest, name: "Guest" },
      selectedSpeed: "ULTRA",
      pauseReason,
    },
  ] as RoomView["grids"];
async function deliver(
  f: ReturnType<typeof fixture>,
  update: Partial<RoomView>,
) {
  await f.project(view(update));
}
function sentCommands(f: ReturnType<typeof fixture>) {
  return f.requests.flatMap((r) =>
    r.kind === "send" && r.payload.kind === "command"
      ? [r.payload.envelope.command]
      : [],
  );
}

test.each([false, true])(
  "a failed reconnect offers Disconnect (prior replica failure: %s)",
  async (replicaFailed) => {
    const f = fixture();
    await f.session.initialize();
    await deliver(f, {});
    expect(f.session.getSnapshot().view).toBeDefined();
    if (replicaFailed) f.failReplica();
    expect(f.session.getSnapshot().error).toBe(
      replicaFailed
        ? "The replica worker stopped. Reconnect to synchronize."
        : undefined,
    );
    f.failReconnect();
    // A native reconnect failure must not reject into an unhandled promise; it settles and
    // reports the loss so the player is not left waiting on a dead link with no way out.
    await expect(f.session.reconnect()).resolves.toBeUndefined();
    const snapshot = f.session.getSnapshot();
    expect(snapshot.error).toBeUndefined();
    expect(snapshot.lobby.error).toBe("Steam could not connect to the host");
    expect(isConnectionLoss(snapshot.error, snapshot.lobby.error)).toBe(true);
    expect(f.session.canLeaveInterruption()).toBe(true);
    f.session.dispose();
  },
);

test("host silence is transient, updates once, and only a current authoritative view clears it", async () => {
  const f = fixture();
  await f.session.initialize();
  await deliver(f, { revision: 2 });
  const changed = jest.fn();
  const stop = f.session.subscribe(changed);
  jest.advanceTimersByTime(5000);
  expect(f.session.getSnapshot().waitingForHost).toBe(false);
  jest.advanceTimersByTime(500);
  expect(f.session.getSnapshot().waitingForHost).toBe(true);
  expect(f.session.getSnapshot().error).toBeUndefined();
  expect(changed).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(2000);
  expect(changed).toHaveBeenCalledTimes(1);
  await deliver(f, { revision: 1 });
  expect(f.session.getSnapshot().waitingForHost).toBe(true);
  // Paused matches legitimately keep publishing the same revision.
  await deliver(f, { revision: 2 });
  expect(f.session.getSnapshot().waitingForHost).toBe(false);
  expect(f.session.getSnapshot().error).toBeUndefined();
  jest.advanceTimersByTime(5000);
  expect(f.session.getSnapshot().waitingForHost).toBe(false);
  stop();
  f.session.dispose();
});

function pulse(f: ReturnType<typeof fixture>, update = {}, sender = host) {
  f.event({
    kind: "message",
    sender,
    payload: {
      kind: "keepalive",
      matchId: "match",
      epoch: "epoch",
      revision: 2,
      ...update,
    },
  });
}

test("authenticated host pulses keep an unchanged paused view healthy without state updates or acknowledging commands", async () => {
  const f = fixture();
  await f.session.initialize();
  await deliver(f, { revision: 2 });
  f.session.command({ kind: "speed", speed: "SLOW" });
  const previous = f.session.getSnapshot();
  const changed = jest.fn();
  const stop = f.session.subscribe(changed);
  for (let second = 0; second < 12; second++) {
    jest.advanceTimersByTime(1000);
    pulse(f, { revision: 3 });
  }
  expect(f.session.getSnapshot()).toBe(previous);
  expect(previous.view!.revision).toBe(2);
  expect(previous.pending).toBe(true);
  expect(changed).not.toHaveBeenCalled();
  stop();
  f.session.dispose();
});

test("only a current well-formed host pulse clears a transient warning and preserves command errors", async () => {
  const f = fixture();
  await f.session.initialize();
  await deliver(f, {
    revision: 2,
    lastSequence: 1,
    receipt: { sequence: 1, error: "Not enough cash" },
  });
  const previousView = f.session.getSnapshot().view;
  jest.advanceTimersByTime(5500);
  expect(f.session.getSnapshot().waitingForHost).toBe(true);
  pulse(f, {}, "outsider");
  for (const update of [
    { matchId: "another" },
    { epoch: "old" },
    { revision: 1 },
    { revision: Infinity },
    { revision: NaN },
    { revision: -1 },
    { revision: 2.5 },
  ])
    pulse(f, update);
  expect(f.session.getSnapshot().waitingForHost).toBe(true);
  pulse(f);
  expect(f.session.getSnapshot()).toMatchObject({
    waitingForHost: false,
    error: "Not enough cash",
    view: previousView,
  });
  expect(f.session.getSnapshot().view).toBe(previousView);
  jest.advanceTimersByTime(5000);
  expect(f.session.getSnapshot().waitingForHost).toBe(false);
  jest.advanceTimersByTime(500);
  expect(f.session.getSnapshot().waitingForHost).toBe(true);
  f.session.dispose();
});

test("worker keepalives relay only to connected guests without replacing the host view", async () => {
  const f = fixture(true);
  await f.session.initialize();
  await f.session.start({ spec: COOP_TEST_SPEC });
  const previous = f.session.getSnapshot();
  const data = {
    kind: "keepalive" as const,
    matchId: "match",
    epoch: "epoch",
    revision: 1,
  };
  f.worker.onmessage?.({ data } as unknown as MessageEvent<WorkerResponse>);
  expect(f.requests.at(-1)).toEqual({
    kind: "send",
    to: guest,
    payload: { ...data, disconnected: [] },
  });
  expect(f.session.getSnapshot()).toBe(previous);
  f.session.dispose();
});

test("worker view credit follows the renderer task and cannot outlive its session", async () => {
  const f = fixture(true);
  await f.session.initialize();
  await f.session.start({ spec: COOP_TEST_SPEC });
  jest.advanceTimersByTime(0);
  f.posts.length = 0;
  const consumed = jest.fn(() => {
    expect(f.posts).not.toContainEqual({ kind: "views-applied" });
  });
  const stop = f.session.subscribe(consumed);
  const publish = () =>
    f.worker.onmessage?.({
      data: {
        kind: "views",
        views: {
          [host]: view({ revision: 2 }),
          [guest]: view({ revision: 2 }),
        },
      },
    } as unknown as MessageEvent<WorkerResponse>);
  publish();
  expect(consumed).toHaveBeenCalledTimes(1);
  expect(f.session.getSnapshot().view?.revision).toBe(2);
  expect(
    f.requests.some(
      (request) =>
        request.kind === "send" &&
        (request.payload as { kind: string }).kind === "view",
    ),
  ).toBe(false);
  expect(f.posts).not.toContainEqual({ kind: "views-applied" });
  jest.advanceTimersByTime(0);
  expect(f.posts).toEqual([
    { kind: "replica-peers", connected: [guest] },
    { kind: "views-applied" },
  ]);
  stop();
  f.posts.length = 0;
  f.session.subscribe(() => f.session.dispose());
  publish();
  jest.advanceTimersByTime(0);
  expect(f.worker.terminate).toHaveBeenCalled();
  expect(f.posts).toEqual([]);
});

test("a guest releases view credit after applying the grid and discards credit queued before disposal", async () => {
  const f = fixture();
  await f.session.initialize();
  await f.project(view({ revision: 1 }));
  const credit = { kind: "views-applied" };
  expect(f.session.getSnapshot().view?.revision).toBe(1);
  expect(f.replicaPosts).not.toContainEqual(credit);
  jest.advanceTimersByTime(0);
  expect(f.replicaPosts).toContainEqual(credit);
  f.replicaPosts.length = 0;
  await f.project(view({ revision: 2 }));
  expect(f.session.getSnapshot().view?.revision).toBe(2);
  f.session.dispose();
  jest.advanceTimersByTime(0);
  expect(f.replicaPosts).not.toContainEqual(credit);
});

test.each(["command", "disconnect"])(
  "host silence preserves a %s error and recovery clears only connection loss",
  async (source) => {
    const f = fixture();
    await f.session.initialize();
    await deliver(
      f,
      source === "command"
        ? {
            lastSequence: 1,
            receipt: { sequence: 1, error: "Not enough cash" },
          }
        : {},
    );
    if (source === "disconnect")
      f.event({ kind: "disconnected", sender: host });
    const error = f.session.getSnapshot().error;
    expect(error).toBeTruthy();
    jest.advanceTimersByTime(5500);
    expect(f.session.getSnapshot().waitingForHost).toBe(true);
    expect(f.session.getSnapshot().error).toBe(error);
    await deliver(f, { revision: 2 });
    expect(f.session.getSnapshot().waitingForHost).toBe(false);
    expect(f.session.getSnapshot().error).toBe(
      source === "disconnect" ? undefined : error,
    );
    f.session.dispose();
  },
);

test("menu pauses queue behind purchases and rapid closing cannot strand everyone paused", async () => {
  const f = fixture();
  await f.session.initialize();
  await deliver(f, { grids: ownGrid() });
  f.session.command({
    kind: "action" as const,
    name: "buildFacility",
    payload: { facility: { name: "Wind", peakW: 50e6 }, financed: true },
  });
  f.session.setActivity("Building power plants");
  expect(sentCommands(f)).toHaveLength(1);
  await deliver(f, {
    revision: 2,
    lastSequence: 1,
    receipt: { sequence: 1 },
    grids: ownGrid(),
  });
  expect(sentCommands(f).at(-1)).toEqual({
    kind: "activity",
    reason: "Building power plants",
  });
  f.session.setActivity(null);
  await deliver(f, {
    revision: 3,
    lastSequence: 2,
    receipt: { sequence: 2 },
    grids: ownGrid("Building power plants"),
  });
  expect(sentCommands(f).at(-1)).toEqual({ kind: "activity", reason: null });
  await deliver(f, {
    revision: 4,
    lastSequence: 3,
    receipt: { sequence: 3 },
    grids: ownGrid(),
  });
  expect(f.session.getSnapshot().pending).toBe(false);
  f.session.dispose();
});

test("overlapping activity changes coalesce and remain applied across a new epoch", async () => {
  const f = fixture();
  await f.session.initialize();
  await deliver(f, { grids: ownGrid() });
  f.session.setActivity("Building power plants");
  f.session.setActivity("Leaving match");
  f.session.setActivity("Reading notification");
  await deliver(f, {
    revision: 2,
    lastSequence: 1,
    receipt: { sequence: 1 },
    grids: ownGrid("Building power plants"),
  });
  expect(sentCommands(f)).toEqual([
    { kind: "activity", reason: "Building power plants" },
    { kind: "activity", reason: "Reading notification" },
  ]);
  await deliver(f, { epoch: "new", revision: 0, grids: ownGrid() });
  expect(sentCommands(f).at(-1)).toEqual({
    kind: "activity",
    reason: "Reading notification",
  });
  f.session.dispose();
});

test("acknowledging an automatic pause does not dismiss its notification", async () => {
  const f = fixture();
  await f.session.initialize();
  await deliver(f, {
    lastSequence: 1,
    receipt: { sequence: 1, error: "Not enough cash" },
    grids: ownGrid(),
  });
  f.session.setActivity("Reading notification");
  expect(f.session.getSnapshot().error).toBe("Not enough cash");
  await deliver(f, {
    revision: 2,
    lastSequence: 2,
    receipt: { sequence: 2 },
    grids: ownGrid("Reading notification"),
  });
  expect(f.session.getSnapshot().error).toBe("Not enough cash");
  f.session.dismissError();
  expect(f.session.getSnapshot().error).toBeUndefined();
  f.session.dispose();
});

test("queued normal actions settle only after their authoritative view reaches subscribers", async () => {
  const f = fixture();
  await f.session.initialize();
  await deliver(f, { grids: ownGrid() });
  let observed = 0;
  const stop = f.session.subscribe(() => {
    observed = f.session.getSnapshot().view!.lastSequence;
  });
  const first = f.session.submit({ kind: "rate", value: 0.2 });
  const second = f.session.submit({ kind: "speed", speed: "SLOW" });
  expect(sentCommands(f)).toHaveLength(1);
  await deliver(f, {
    revision: 2,
    lastSequence: 1,
    receipt: { sequence: 1 },
    grids: ownGrid(),
  });
  await first;
  expect(observed).toBe(1);
  expect(sentCommands(f).at(-1)).toEqual({ kind: "speed", speed: "SLOW" });
  await deliver(f, {
    revision: 3,
    lastSequence: 2,
    receipt: { sequence: 2, error: "Rejected" },
    grids: ownGrid(),
  });
  await expect(second).rejects.toThrow("Rejected");
  stop();
  f.session.dispose();
});

test("a locally rejected queued Ready does not strand the next command", async () => {
  const f = fixture();
  await f.session.initialize();
  await deliver(f, { grids: ownGrid() });
  const first = f.session.submit({ kind: "rate", value: 0.2 });
  const ready = f.session.submit({ kind: "ready" });
  const rejected = ready.catch((error: Error) => error.message);
  const last = f.session.submit({ kind: "speed", speed: "SLOW" });
  await deliver(f, {
    revision: 2,
    lastSequence: 1,
    receipt: { sequence: 1 },
    disconnected: [host],
    grids: ownGrid(),
  });
  await first;
  await expect(rejected).resolves.toContain("reconnect");
  expect(sentCommands(f)).toEqual([
    { kind: "rate", value: 0.2 },
    { kind: "speed", speed: "SLOW" },
  ]);
  await deliver(f, {
    revision: 3,
    lastSequence: 2,
    receipt: { sequence: 2 },
    grids: ownGrid(),
  });
  await last;
  f.session.dispose();
});

test.each(["lock", "factory", "response", "onerror"] as const)(
  "rolls back %s startup failures and permits a retry",
  async (failure) => {
    const f = fixture(true);
    await f.session.initialize();
    f.session.publishBrowse({
      phase: "playing",
      card: "CUSTOM_GAME",
      custom: COOP_TEST_SPEC.customScenario,
      difficulty: COOP_TEST_SPEC.difficulty,
    });
    const playing = f.session.getSnapshot().browse!;
    f.startup(
      failure === "lock" || failure === "factory" ? failure : "delayed",
    );
    let stale: typeof f.worker.onmessage = null;
    const startError = await f.session
      .start({ spec: COOP_TEST_SPEC })
      .catch((error: Error) => error.message);
    expect(startError).toBe(
      failure === "lock"
        ? "Lock failed"
        : failure === "factory"
          ? "Factory failed"
          : undefined,
    );
    if (failure === "response" || failure === "onerror") {
      stale = f.worker.onmessage;
      if (failure === "response")
        f.worker.onmessage!({
          data: { kind: "error", message: "Initialization failed" },
        } as unknown as MessageEvent<WorkerResponse>);
      else f.worker.onerror!(new Event("error"));
    }
    const state = f.session.getSnapshot();
    expect(state.busy).toBe(false);
    expect(coopSelection(state).starting).toBe(false);
    expect(state.view).toBeUndefined();
    expect(state.error).toBeTruthy();
    expect(state.browse).toMatchObject({
      ...playing,
      phase: "browsing",
      revision: playing.revision + 1,
    });
    jest.advanceTimersByTime(200);
    expect(f.requests).toContainEqual({
      kind: "send",
      to: guest,
      payload: { kind: "browse", browse: state.browse },
    });
    expect(
      f.requests.filter((request) => request.kind === "unlock"),
    ).toHaveLength(failure === "lock" ? 0 : 1);
    expect(f.worker.terminate).toHaveBeenCalledTimes(
      failure === "response" || failure === "onerror" ? 1 : 0,
    );
    f.startup();
    await f.session.start({ spec: COOP_TEST_SPEC });
    expect(f.session.getSnapshot().view).toBeDefined();
    stale?.({
      data: { kind: "views", views: { [host]: view({ epoch: "stale" }) } },
    } as unknown as MessageEvent<WorkerResponse>);
    expect(f.session.getSnapshot().view?.epoch).toBe("epoch");
    stale?.({
      data: { kind: "error", message: "Late failure" },
    } as unknown as MessageEvent<WorkerResponse>);
    expect(f.session.getSnapshot().error).toBeUndefined();
    f.session.dispose();
  },
);

test("a worker error after its first view preserves the established match", async () => {
  const f = fixture(true);
  await f.session.initialize();
  await f.session.start({ spec: COOP_TEST_SPEC });
  f.worker.onmessage!({
    data: { kind: "error", message: "Runtime failed" },
  } as unknown as MessageEvent<WorkerResponse>);
  expect(f.session.getSnapshot().view).toBeDefined();
  expect(f.session.getSnapshot().error).toBe("Runtime failed");
  expect(f.worker.terminate).not.toHaveBeenCalled();
  expect(f.requests).not.toContainEqual({ kind: "unlock" });
  f.session.dispose();
});

test("the first online checkpoint must commit before the match opens", async () => {
  let live = true;
  const f = fixture(true, false, {
    onlineCampaigns: true,
    authority: () =>
      live
        ? {
            epoch: "epoch",
            monotonicDeadline: Infinity,
            wallDeadline: Infinity,
          }
        : undefined,
  });
  await f.session.initialize();
  await f.session.start({ spec: COOP_TEST_SPEC });
  live = false;
  f.worker.onmessage?.({
    data: { kind: "checkpoint", world: { epoch: "epoch" } },
  } as MessageEvent<WorkerResponse>);
  await settle();
  await settle();
  expect(f.worker.terminate).toHaveBeenCalled();
  expect(f.posts.some(({ kind }) => kind === "replication-open")).toBe(false);
  expect(f.requests.some(({ kind }) => kind === "checkpoint")).toBe(false);
  f.session.dispose();
});

test("a guest menu save waits for the host's checkpoint acknowledgement", async () => {
  const f = fixture();
  await f.session.initialize();
  await deliver(f, {});
  const saving = f.session.save();
  const request = f.requests.at(-1);
  expect(request).toMatchObject({
    kind: "send",
    to: host,
    payload: { kind: "save-request" },
  });
  if (request?.kind !== "send" || request.payload.kind !== "save-request")
    throw new Error("No save request");
  f.event({
    kind: "message",
    sender: host,
    payload: { kind: "save-result", requestId: request.payload.requestId },
  });
  await expect(saving).resolves.toBeUndefined();
  const failure = f.session.save();
  jest.advanceTimersByTime(5000);
  await expect(failure).rejects.toThrow("host could not finish the save");
  f.session.dispose();
});

test("a local ready while disconnected rejects its promise without blocking later commands", async () => {
  const f = fixture();
  await f.session.initialize();
  await deliver(f, { disconnected: [host] });
  await expect(f.session.submit({ kind: "ready" })).rejects.toThrow(
    "reconnect",
  );
  const next = f.session.submit({ kind: "speed", speed: "SLOW" });
  await deliver(f, { revision: 2, lastSequence: 1, receipt: { sequence: 1 } });
  await next;
  f.session.dispose();
});

test("a guest whose host cannot save stays in the match and can leave without saving", async () => {
  const f = fixture();
  await f.session.initialize();
  await deliver(f, {});
  const leaving = f.session.leave();
  jest.advanceTimersByTime(5000);
  await expect(leaving).rejects.toThrow("host could not finish the save");
  expect(f.requests.some((r) => r.kind === "leave")).toBe(false);
  expect(f.session.getSnapshot().view).toBeDefined();
  // A failed save must not wedge the session: later commands still reach the host.
  f.session.command({ kind: "speed", speed: "SLOW" });
  expect(sentCommands(f)).toEqual([{ kind: "speed", speed: "SLOW" }]);
  await f.session.leave({ skipSave: true });
  expect(f.requests.at(-1)).toEqual({ kind: "leave" });
  expect(f.session.getSnapshot().view).toBeUndefined();
  f.session.dispose();
});

test("a host leaving without saving skips the checkpoint", async () => {
  const f = fixture(true);
  await f.session.initialize();
  await f.session.start({ spec: COOP_TEST_SPEC });
  await f.session.leave({ skipSave: true });
  expect(f.posts.some((p) => p.kind === "checkpoint")).toBe(false);
  expect(f.worker.terminate).toHaveBeenCalled();
  expect(f.session.getSnapshot().view).toBeUndefined();
  f.session.dispose();
});

test("a failed lobby exit still ends the local match and accepts the next one", async () => {
  const f = fixture();
  f.failLeave();
  await f.session.initialize();
  await deliver(f, {});
  await expect(f.session.leave({ skipSave: true })).resolves.toBeUndefined();
  expect(f.requests.at(-1)).toEqual({ kind: "leave" });
  expect(f.session.getSnapshot().view).toBeUndefined();
  expect(f.session.getSnapshot().lobby.lobbyId).toBeUndefined();
  // The next match starts only after this guest joins another lobby.
  f.event({
    kind: "state",
    state: {
      available: true,
      selfId: guest,
      hostId: host,
      lobbyId: "next-lobby",
      members: [
        { id: host, name: "Host" },
        { id: guest, name: "Guest" },
      ],
      connected: [host],
    },
  });
  await deliver(f, { epoch: "next" });
  const next = f.session.submit({ kind: "speed", speed: "SLOW" });
  expect(sentCommands(f)).toEqual([{ kind: "speed", speed: "SLOW" }]);
  await deliver(f, {
    epoch: "next",
    revision: 2,
    lastSequence: 1,
    receipt: { sequence: 1 },
  });
  await expect(next).resolves.toBeUndefined();
  f.session.dispose();
});

test("a saved leave succeeds even when Steam cannot leave the lobby", async () => {
  const f = fixture(true);
  f.failLeave();
  await f.session.initialize();
  await f.session.start({ spec: COOP_TEST_SPEC });
  await expect(f.session.leave()).resolves.toBeUndefined();
  expect(f.posts.at(-1)).toMatchObject({ kind: "checkpoint", pause: true });
  expect(f.requests.some((r) => r.kind === "checkpoint")).toBe(true);
  expect(f.requests.at(-1)).toEqual({ kind: "leave" });
  expect(f.worker.terminate).toHaveBeenCalled();
  expect(f.session.getSnapshot().view).toBeUndefined();
  f.session.dispose();
});

const browse = (update: Partial<BrowseState> = {}): BrowseState => ({
  session: "browse",
  revision: 1,
  phase: "browsing",
  card: "NEW_GAME_DETAILS",
  scenarioId: 101,
  difficulty: "Employee",
  ...update,
});
const sentBrowse = (f: ReturnType<typeof fixture>) =>
  f.requests.flatMap((r) =>
    r.kind === "send" && r.payload.kind === "browse"
      ? [{ to: r.to, revision: r.payload.browse.revision }]
      : [],
  );

test("a guest follows only the newest valid selection from its own host", async () => {
  const f = fixture();
  await f.session.initialize();
  const send = (sender: string, value: unknown) =>
    f.event({
      kind: "message",
      sender,
      payload: { kind: "browse", browse: value as BrowseState },
    });
  send(host, browse({ revision: 2 }));
  expect(f.session.getSnapshot().browse?.revision).toBe(2);
  send(host, browse({ revision: 1, scenarioId: 102 }));
  send("stranger", browse({ revision: 9, scenarioId: 103 }));
  expect(f.session.getSnapshot().browse?.scenarioId).toBe(101);
  // A tutorial is never a shared game; the guest keeps what it had and says it's out of sync.
  send(host, browse({ revision: 3, scenarioId: 1 }));
  expect(f.session.getSnapshot().browse?.revision).toBe(2);
  expect(f.session.getSnapshot().error).toMatch(/out of sync/);
  send(host, browse({ session: "next", revision: 0, card: "NEW_GAME" }));
  expect(f.session.getSnapshot().browse).toMatchObject({
    session: "next",
    card: "NEW_GAME",
  });
  f.session.dispose();
});

test("the host coalesces its selection, catches joiners up at once and resends it now and then", async () => {
  const f = fixture(true);
  await f.session.initialize();
  const selection = {
    phase: "browsing" as const,
    card: "NEW_GAME" as const,
    difficulty: "Employee" as const,
  };
  f.session.publishBrowse(selection);
  f.session.publishBrowse(selection);
  f.session.publishBrowse({ ...selection, card: "CUSTOM_GAME" });
  expect(sentBrowse(f)).toEqual([]);
  jest.advanceTimersByTime(200);
  expect(sentBrowse(f)).toEqual([{ to: guest, revision: 2 }]);
  f.event({
    kind: "state",
    state: {
      ...f.session.getSnapshot().lobby,
      members: [
        ...f.session.getSnapshot().lobby.members,
        { id: "late", name: "Late" },
      ],
      connected: [guest, "late"],
    },
  });
  expect(sentBrowse(f).at(-1)).toEqual({ to: "late", revision: 2 });
  const before = sentBrowse(f).length;
  jest.advanceTimersByTime(2500);
  expect(sentBrowse(f).length).toBeGreaterThan(before);
  f.session.dispose();
});

test("custom setup waits for the host's settings before offering Ready", async () => {
  const f = fixture();
  await f.session.initialize();
  sendBrowse(f, browse({ card: "CUSTOM_GAME" }));
  expect(coopSelection(f.session.getSnapshot()).receivingScenario).toBe(true);
  sendBrowse(
    f,
    browse({
      card: "CUSTOM_GAME",
      revision: 2,
      custom: { ...DEFAULT_CUSTOM_SCENARIO, seed: 2468 },
    }),
  );
  expect(coopSelection(f.session.getSnapshot()).receivingScenario).toBe(false);
  const key = selectionKey(f.session.getSnapshot().browse!);
  await f.session.setReady(key);
  expect(coopSelection(f.session.getSnapshot()).ready).toBe(true);

  // If the host changes the grid, the editor withdraws the old setup while sizing it.
  sendBrowse(f, browse({ card: "CUSTOM_GAME", revision: 3 }));
  expect(coopSelection(f.session.getSnapshot())).toMatchObject({
    receivingScenario: true,
    ready: false,
  });
  await expect(f.session.setReady(key)).rejects.toThrow("Receiving scenario");
  sendBrowse(
    f,
    browse({
      card: "CUSTOM_GAME",
      revision: 4,
      custom: {
        ...DEFAULT_CUSTOM_SCENARIO,
        seed: 2468,
        startingCustomers: 2_000_000,
      },
    }),
  );
  expect(coopSelection(f.session.getSnapshot())).toMatchObject({
    receivingScenario: false,
    ready: false,
  });
  await f.session.setReady(selectionKey(f.session.getSnapshot().browse!));
  expect(coopSelection(f.session.getSnapshot()).ready).toBe(true);
  f.session.dispose();
});

test("a guest's finished match closes when the host goes back to choosing, and Ready names the selection", async () => {
  const f = fixture();
  await f.session.initialize();
  await deliver(f, {});
  expect(f.session.getSnapshot().view).toBeDefined();
  f.event({
    kind: "message",
    sender: host,
    payload: { kind: "browse", browse: browse({ card: "NEW_GAME" }) },
  });
  expect(f.session.getSnapshot().view).toBeUndefined();
  expect(f.session.getSnapshot().browse?.card).toBe("NEW_GAME");
  sendBrowse(f, browse({ revision: 2 }));
  await f.session.setReady("101|Employee|");
  expect(f.requests.at(-1)).toEqual({
    kind: "member",
    key: "ready",
    value: "101|Employee|",
  });
  f.session.dispose();
});

function communityScenario(
  seed = 2468,
  difficulty: import("../Types").DifficultyType = "Employee",
) {
  return modScenario(
    {
      schemaVersion: 1,
      gameApi: 1,
      id: "shared-grid",
      title: "Shared grid",
      creator: "Fixture author",
      version: "1",
      description: "Each company chooses its own route.",
      seed,
      baseScenarioId: 999,
      scenario: { startingYear: 2020, durationMonths: 6 },
      officialArcs: [],
      objectives: [],
      events: [
        {
          id: "hidden",
          title: "Secret event",
          message: "A hidden event arrives.",
          visibility: "surprise",
          startMonth: 3,
          durationMonths: 1,
        },
      ],
    },
    undefined,
    difficulty,
  );
}
const communityBrowse = (
  scenario: import("../Types").ScenarioType,
  revision = 1,
): BrowseState =>
  browse({
    card: "MODS",
    scenarioId: undefined,
    difficulty: scenario.mod!.parameters.difficulty,
    mod: modBrowseSummary(scenario),
    revision,
  });
function sendBrowse(f: ReturnType<typeof fixture>, value: BrowseState) {
  f.event({
    kind: "message",
    sender: host,
    payload: { kind: "browse", browse: value },
  });
}
function sendScenario(
  f: ReturnType<typeof fixture>,
  scenario: import("../Types").ScenarioType,
  key = selectionKey(communityBrowse(scenario)),
  sender = host,
) {
  f.event({
    kind: "message",
    sender,
    payload: { kind: "scenario", selectionKey: key, scenario },
  });
}

test("community browse contains bounded safe facts and never the full or hidden rules", () => {
  const scenario = communityScenario();
  const selected = communityBrowse(scenario);
  expect(validBrowseState(selected)).toBe(true);
  expect(JSON.stringify(selected)).not.toMatch(
    /Secret event|hidden|rules|description/,
  );
  expect(utf8Bytes(JSON.stringify(selected)).length).toBeLessThan(16 * 1024);
  expect(validBrowseState({ ...selected, custom: scenario })).toBe(false);
  expect(validBrowseState({ ...selected, scenarioSnapshot: scenario })).toBe(
    false,
  );
  expect(
    validBrowseState({
      ...selected,
      mod: { ...selected.mod, title: "<img src=x>" },
    }),
  ).toBe(false);
  expect(
    validBrowseState({
      ...selected,
      mod: { ...selected.mod, creator: "https://unsafe.example" },
    }),
  ).toBe(false);
  expect(validBrowseState({ ...selected, difficulty: "CEO" })).toBe(false);
  expect(
    validBrowseState({
      ...selected,
      mod: { ...selected.mod, title: "é".repeat(16000) },
    }),
  ).toBe(false);
});

test("a host transfers a selected snapshot separately, including late joins and reconnects", async () => {
  const f = fixture(true);
  await f.session.initialize();
  const scenario = communityScenario();
  const {
    session: _session,
    revision: _revision,
    ...selection
  } = communityBrowse(scenario);
  f.session.publishBrowse({ ...selection, scenarioSnapshot: scenario });
  jest.advanceTimersByTime(200);
  const sent = f.requests.filter((request) => request.kind === "send");
  expect(
    sent.some(
      (request) =>
        request.kind === "send" &&
        request.payload.kind === "scenario" &&
        request.payload.scenario.mod?.runtimeDigest ===
          scenario.mod?.runtimeDigest,
    ),
  ).toBe(true);
  const published = f.session.getSnapshot().browse!;
  expect(JSON.stringify(published)).not.toMatch(/rules|Secret event/);
  const connected = (ids: string[]) =>
    f.event({
      kind: "state",
      state: {
        ...f.session.getSnapshot().lobby,
        connected: ids,
        members: [
          { id: host, name: "Host" },
          { id: guest, name: "Guest" },
          { id: "late", name: "Late" },
        ],
      },
    });
  connected([guest, "late"]);
  expect(f.requests.at(-1)).toMatchObject({
    kind: "send",
    to: "late",
    payload: { kind: "scenario" },
  });
  connected(["late"]);
  connected([guest, "late"]);
  expect(f.requests.at(-1)).toMatchObject({
    kind: "send",
    to: guest,
    payload: { kind: "scenario" },
  });
  // Detaching protects the accepted run from changes to the caller's package/library object.
  scenario.mod!.source.title = "Changed outside session";
  expect(f.session.getSnapshot().scenarioSnapshot?.mod?.source.title).toBe(
    "Shared grid",
  );
  f.session.dispose();
});

test("Ready requires the host's matching validated snapshot and selection changes clear consent", async () => {
  const f = fixture();
  await f.session.initialize();
  const first = communityScenario();
  sendBrowse(f, communityBrowse(first));
  const key = selectionKey(f.session.getSnapshot().browse!);
  expect(coopSelection(f.session.getSnapshot()).receivingScenario).toBe(true);
  await expect(f.session.setReady(key)).rejects.toThrow(/Receiving scenario/);
  sendScenario(f, first, key, "stranger");
  expect(f.session.getSnapshot().scenarioSnapshot).toBeUndefined();
  const forged = JSON.parse(JSON.stringify(first));
  forged.mod.rules.durationMonths = 7;
  sendScenario(f, forged, key);
  expect(f.session.getSnapshot().scenarioSnapshot).toBeUndefined();
  sendScenario(f, first, `${key}wrong`);
  expect(f.session.getSnapshot().scenarioSnapshot).toBeUndefined();
  sendScenario(f, first, key);
  expect(coopSelection(f.session.getSnapshot()).receivingScenario).toBe(false);
  expect(coopSelection(f.session.getSnapshot()).modScenario).toEqual(first);
  expect(coopSelection(f.session.getSnapshot()).custom).toBeUndefined();
  await f.session.setReady(key);
  expect(f.requests.at(-1)).toMatchObject({
    kind: "member",
    key: "ready",
    value: key,
  });
  const next = communityScenario(9753, "Manager");
  sendBrowse(f, communityBrowse(next, 2));
  expect(f.session.getSnapshot().scenarioSnapshot).toBeUndefined();
  expect(coopSelection(f.session.getSnapshot()).ready).toBe(false);
  sendScenario(f, first, key);
  expect(f.session.getSnapshot().scenarioSnapshot).toBeUndefined();
  sendScenario(f, next);
  expect(f.session.getSnapshot().scenarioSnapshot?.seed).toBe(9753);
  // An old transfer arriving later cannot replace the active matching snapshot.
  sendScenario(f, first, key);
  expect(f.session.getSnapshot().scenarioSnapshot?.seed).toBe(9753);
  f.session.dispose();
});

test("a snapshot arriving before browse is held privately until the advertised selection matches", async () => {
  const f = fixture();
  await f.session.initialize();
  const scenario = communityScenario();
  sendScenario(f, scenario);
  expect(f.session.getSnapshot().scenarioSnapshot).toBeUndefined();
  sendBrowse(f, communityBrowse(scenario));
  expect(f.session.getSnapshot().scenarioSnapshot).toEqual(scenario);
  f.session.dispose();
});

function communityBaseline(
  scenario: import("../Types").ScenarioType,
  matchId = "match",
  epoch = "epoch",
): ReplicaBaseline {
  return new ReplicatedWorld(
    createWorld(
      {
        scenarioId: 999,
        difficulty: scenario.mod!.parameters.difficulty,
        customScenario: scenario,
      },
      [
        { id: host, name: "Host" },
        { id: guest, name: "Guest" },
      ],
      matchId,
      epoch,
    ),
  ).baseline();
}
test("replica baselines keep pinned definitions and reject different mod identities or setup", async () => {
  const f = fixture();
  await f.session.initialize();
  const scenario = communityScenario();
  sendBrowse(f, communityBrowse(scenario));
  sendScenario(f, scenario);
  await f.baseline(communityBaseline(scenario));
  expect(f.session.getSnapshot().view?.game?.customScenario).toEqual(scenario);
  const accepted = f.session.getSnapshot().view;
  const forged = communityBaseline(scenario);
  forged.world.spec.customScenario!.mod!.rules.events[0].message =
    "Forged contents";
  await f.baseline(forged);
  expect(f.session.getSnapshot().view).toBe(accepted);
  expect(f.session.getSnapshot().synchronizing).toBe(true);
  await f.baseline(communityBaseline(communityScenario(9)));
  expect(f.session.getSnapshot().view).toBe(accepted);
  const wrongSeed = communityBaseline(scenario);
  wrongSeed.world.grids[1].seed++;
  await f.baseline(wrongSeed);
  expect(f.session.getSnapshot().view).toBe(accepted);
  await f.baseline(communityBaseline(scenario));
  expect(f.session.getSnapshot().synchronizing).toBe(false);
  expect(
    f.session.getSnapshot().view?.game?.customScenario?.mod?.rules.events[0]
      .message,
  ).toBe("A hidden event arrives.");
  f.session.dispose();
});

test("a resumed mod baseline waits for its separately validated scenario without any library lookup", async () => {
  const f = fixture();
  await f.session.initialize();
  const scenario = communityScenario();
  await f.baseline(communityBaseline(scenario));
  expect(f.session.getSnapshot().view).toBeUndefined();
  expect(f.replicaPosts).toEqual([]);
  sendScenario(f, scenario);
  await flushReplica();
  expect(f.session.getSnapshot().view?.game?.customScenario).toEqual(scenario);
  expect(
    f.requests.some(
      (request) => !["state", "send", "member"].includes(request.kind),
    ),
  ).toBe(false);
  f.session.dispose();
});

test.each([2468, 1357])(
  "a campaign transition discards stale definitions before a paused resume (seed %i)",
  async (seed) => {
    const f = fixture();
    await f.session.initialize();
    const old = communityScenario();
    sendScenario(f, old);
    sendBrowse(f, communityBrowse(old));
    sendBrowse(f, browse({ revision: 2, card: "NEW_GAME" }));
    f.event({
      kind: "message",
      sender: host,
      payload: { kind: "campaign", campaign },
    });
    const resumed = communityScenario(seed);
    await f.baseline(communityBaseline(resumed, "resumed", "resumed-epoch"));
    expect(f.session.getSnapshot().view).toBeUndefined();
    sendScenario(f, resumed);
    await flushReplica();
    expect(f.session.getSnapshot().view?.matchId).toBe("resumed");
    expect(f.session.getSnapshot().view?.game?.customScenario?.seed).toBe(seed);
    f.session.dispose();
  },
);

test("new matches and reconnect baselines send frozen mod definitions before the ordered stream", async () => {
  const f = fixture(true);
  await f.session.initialize();
  const scenario = communityScenario();
  const {
    session: _session,
    revision: _revision,
    ...selected
  } = communityBrowse(scenario);
  f.session.publishBrowse({ ...selected, scenarioSnapshot: scenario });
  const key = selectionKey(f.session.getSnapshot().browse!);
  const spec = {
    scenarioId: 999,
    difficulty: "Employee" as const,
    customScenario: scenario,
  };
  await expect(f.session.start({ spec })).rejects.toThrow(/mark Ready/);
  f.event({
    kind: "state",
    state: {
      ...f.session.getSnapshot().lobby,
      members: [
        { id: host, name: "Host" },
        { id: guest, name: "Guest", ready: key },
      ],
    },
  });
  const sentSnapshots = () =>
    f.requests.filter(
      (request) =>
        request.kind === "send" &&
        request.to === guest &&
        request.payload.kind === "scenario",
    ).length;
  const publish = async () => {
    f.worker.onmessage?.({
      data: {
        kind: "baseline",
        to: guest,
        baseline: communityBaseline(scenario),
      },
    } as MessageEvent<WorkerResponse>);
    await flushReplica();
  };
  await f.session.start({ spec });
  const before = sentSnapshots();
  const initial = f.requests.length;
  await publish();
  expect(sentSnapshots()).toBe(before + 1);
  expect(
    f.requests
      .slice(initial)
      .map((request) =>
        request.kind === "send" ? request.payload.kind : request.kind,
      ),
  ).toEqual(["scenario", "baseline"]);
  await publish();
  expect(sentSnapshots()).toBe(before + 1);
  f.event({
    kind: "state",
    state: { ...f.session.getSnapshot().lobby, connected: [] },
  });
  f.event({
    kind: "state",
    state: { ...f.session.getSnapshot().lobby, connected: [guest] },
  });
  expect(f.posts.at(-1)).toEqual({ kind: "baseline", to: guest });
  const reconnect = sentSnapshots();
  await publish();
  expect(sentSnapshots()).toBe(reconnect + 1);
  await f.session.backToLobby();
  f.session.publishBrowse({ ...selected, scenarioSnapshot: scenario });
  await f.session.start({ spec });
  const resumed = sentSnapshots();
  await publish();
  expect(sentSnapshots()).toBe(resumed + 1);
  f.session.dispose();
});

test("a host restarts the finished match with the same configuration and players", async () => {
  const f = fixture(true);
  await f.session.initialize();
  const created = () => f.posts.filter((post) => post.kind === "create");
  // Nothing to repeat until a match has been started.
  await f.session.restart();
  expect(created()).toHaveLength(0);
  await f.session.start({ spec: COOP_TEST_SPEC });
  expect(created()).toHaveLength(1);
  await f.session.restart();
  // The finished match's saved campaign is set aside, so the same lobby can play on.
  expect(f.requests.filter((request) => request.kind === "unlock")).toEqual([
    { kind: "unlock", finished: true },
  ]);
  expect(created()).toHaveLength(2);
  expect(created()[1]).toMatchObject({
    kind: "create",
    spec: COOP_TEST_SPEC,
    seats: created()[0].kind === "create" ? created()[0].seats : [],
  });
  expect(f.session.getSnapshot().view).toBeDefined();
  f.session.dispose();
});

test("a guest cannot restart a match", async () => {
  const f = fixture(false);
  await f.session.initialize();
  await f.session.restart();
  expect(f.posts.filter((post) => post.kind === "create")).toHaveLength(0);
  expect(f.requests).not.toContainEqual({ kind: "unlock" });
  f.session.dispose();
});

test("a host sleep checkpoint keeps its session open for an explicit resume", async () => {
  const f = fixture(true);
  await f.session.initialize();
  await f.session.start({ spec: COOP_TEST_SPEC });
  await f.session.save(true, true);
  expect(f.posts.at(-1)).toMatchObject({
    kind: "checkpoint",
    pause: true,
    suspended: true,
  });
  const before = f.posts.length;
  f.session.command({ kind: "speed", speed: "NORMAL" });
  expect(f.posts.slice(before)).toContainEqual(
    expect.objectContaining({
      kind: "command",
      envelope: expect.objectContaining({
        command: { kind: "speed", speed: "NORMAL" },
      }),
    }),
  );
  f.session.dispose();
});

test("a sleep checkpoint discards unsent readiness while retaining an in-flight economic command", async () => {
  const f = fixture(true);
  await f.session.initialize();
  await f.session.start({ spec: COOP_TEST_SPEC });
  const rate = f.session.submit({ kind: "rate", value: 0.2 });
  const ready = f.session
    .submit({ kind: "ready" })
    .catch((error: Error) => error.message);
  const speed = f.session
    .submit({ kind: "speed", speed: "NORMAL" })
    .catch((error: Error) => error.message);
  await f.session.save(true, true);
  f.worker.onmessage!({
    data: {
      kind: "views",
      views: {
        [host]: view({
          revision: 2,
          lastSequence: 1,
          receipt: { sequence: 1 },
        }),
      },
    },
  } as unknown as MessageEvent<WorkerResponse>);
  await rate;
  expect(f.posts.filter((request) => request.kind === "command")).toHaveLength(
    1,
  );
  await expect(ready).resolves.toContain("sleep");
  await expect(speed).resolves.toContain("sleep");
  f.session.command({ kind: "speed", speed: "NORMAL" });
  expect(f.posts.at(-1)).toMatchObject({
    kind: "command",
    envelope: { command: { kind: "speed", speed: "NORMAL" } },
  });
  f.session.dispose();
});

test("a guest sleep requests an immediate authoritative pause even with an economic command in flight", async () => {
  const f = fixture();
  await f.session.initialize();
  await deliver(f, {});
  f.session.command({ kind: "rate", value: 0.2 });
  const sleeping = f.session.save(true, true);
  const request = f.requests.at(-1);
  expect(request).toMatchObject({
    kind: "send",
    to: host,
    payload: { kind: "save-request", suspended: true },
  });
  if (request?.kind !== "send" || request.payload.kind !== "save-request")
    throw new Error("No save request");
  f.event({
    kind: "message",
    sender: host,
    payload: { kind: "save-result", requestId: request.payload.requestId },
  });
  await sleeping;
  f.session.dispose();
});

test("a host treats a guest sleep save request as a safety stop requiring fresh readiness", async () => {
  const f = fixture(true);
  await f.session.initialize();
  await f.session.start({ spec: COOP_TEST_SPEC });
  f.event({
    kind: "message",
    sender: guest,
    payload: { kind: "save-request", requestId: "sleep", suspended: true },
  });
  expect(f.posts.at(-1)).toMatchObject({
    kind: "checkpoint",
    pause: true,
    suspended: true,
  });
  f.session.dispose();
});

test.each([
  {},
  { territoryId: "champlain" },
  { tileId: "champlain:site-13" },
  { territoryId: "champlain", tileId: "champlain:site-13" },
])(
  "build submission preserves destination %j and strips client economics",
  async (destination) => {
    const f = fixture();
    await f.session.initialize();
    await deliver(f, { grids: ownGrid() });
    const submitted = f.session.submit({
      kind: "action",
      name: "buildFacility",
      payload: {
        facility: { name: "Wind", peakW: 50e6, buildCost: 1 },
        financed: true,
        ...destination,
        quotedCost: 1,
        operatingAreaId: "untrusted",
      },
    });
    expect(sentCommands(f)).toEqual([
      {
        kind: "action",
        name: "buildFacility",
        payload: {
          facility: {
            name: "Wind",
            peakW: 50e6,
            peakWh: undefined,
            gasCycle: undefined,
            resilience: undefined,
          },
          financed: true,
          ...destination,
        },
      },
    ]);
    await deliver(f, {
      revision: 2,
      lastSequence: 1,
      receipt: { sequence: 1 },
      grids: ownGrid(),
    });
    await submitted;
    f.session.dispose();
  },
);

test("the host builds the exact project site selected through a public session", async () => {
  loadSimData(UTILITY_AREAS.champlain.location);
  const world = createWorld(
    { scenarioId: 116, difficulty: "Employee" },
    [
      { id: host, name: "Host" },
      { id: guest, name: "Guest" },
    ],
    "match",
    "epoch",
  );
  const game = world.grids[1];
  currentTick(game)!.cash = 1e9;
  const project = getBuildFacilityQuote(game, { name: "Wind", peakW: 20e6 })!;
  const sites = availableTerritoryTiles(game, project, "champlain");
  expect(sites.length).toBeGreaterThan(1);
  const target = sites[sites.length - 1];
  const quote = getBuildFacilityQuote(
    game,
    project,
    target.territoryId,
    target.id,
  )!;
  const reviewKey = facilityConstructionReview(
    game,
    quote,
    false,
    target.id,
  ).key;
  const beforeIds = new Set(game.facilities.map(({ id }) => id));
  const f = fixture();
  await f.session.initialize();
  await deliver(f, { grids: ownGrid() });
  const submitted = f.session.submit({
    kind: "action",
    name: "buildFacility",
    payload: {
      facility: { ...project, buildCost: 1, yearsToBuild: 0 },
      financed: false,
      territoryId: target.territoryId,
      tileId: target.id,
      reviewKey,
    },
  });
  expect(sentCommands(f)[0]).toMatchObject({ payload: { reviewKey } });
  expect(
    applyCommand(world, guest, {
      matchId: world.matchId,
      epoch: world.epoch,
      sequence: 1,
      command: sentCommands(f)[0],
    }),
  ).toBeUndefined();
  expect(
    world.grids[1].facilities.filter(({ id }) => !beforeIds.has(id)),
  ).toEqual([
    expect.objectContaining({
      name: project.name,
      territoryId: target.territoryId,
      tileId: target.id,
      buildCost: quote.buildCost,
      yearsToBuildLeft: quote.yearsToBuild,
    }),
  ]);
  await deliver(f, {
    revision: 2,
    lastSequence: 1,
    receipt: { sequence: 1 },
    grids: ownGrid(),
  });
  await submitted;
  f.session.dispose();
});
