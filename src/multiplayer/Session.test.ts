import { HOST_LEFT, MultiplayerSession } from "./Session";
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
import { coopSelection } from "./Choosing";

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
function fixture(isHost = false, deferLeave = false) {
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
    failLeave = false;
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
      if (request.kind === "lock" && failLock) throw new Error("Lock failed");
      if (request.kind === "leave" && deferLeave)
        await new Promise<void>((resolve) => {
          releaseLeave = resolve;
        });
      if (request.kind === "checkpoint" && failSave)
        throw new Error("Disk full");
      if (request.kind === "leave" && failLeave)
        throw new Error("Steam unavailable");
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
  const session = new MultiplayerSession(bridge, async () => {
    if (failFactory) throw new Error("Factory failed");
    return worker as unknown as Worker;
  });
  return {
    session,
    worker,
    requests,
    posts,
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
    startup: (failure?: "lock" | "factory" | "delayed") => {
      failLock = failure === "lock";
      failFactory = failure === "factory";
      delayStart = failure === "delayed";
    },
  };
}
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
  });
  expect(f.posts.at(-1)).toMatchObject({
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
  });
  expect(f.posts.at(-1)).toMatchObject({
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

test("campaign resume retains legacy names through 200 characters and gives unnamed players an identity label", async () => {
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
  const frame = (revision: number): NativeEvent => ({
    kind: "message",
    sender: host,
    payload: { kind: "view", view: view({ revision }) },
  });
  f.event(frame(1));
  // Skip the host save so the test holds the session inside the native lobby exit.
  const leaving = f.session.leave({ skipSave: true });
  f.event(frame(2));
  expect(f.session.getSnapshot().view?.revision).toBe(1);
  f.releaseLeave();
  await leaving;
  expect(f.session.getSnapshot().lobby).toMatchObject({
    lobbyId: undefined,
    hostId: undefined,
    members: [],
    connected: [],
  });
  f.event(frame(3));
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
  f.event(frame(4));
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
  f.event({
    kind: "message",
    sender: host,
    payload: { kind: "view", view: view({ revision: 5 }) },
  });
  expect(f.session.getSnapshot().view?.epoch).toBe("epoch");
  f.event({
    kind: "message",
    sender: host,
    payload: { kind: "view", view: view({ epoch: "restored", revision: 0 }) },
  });
  expect(f.session.getSnapshot().view?.epoch).toBe("restored");
  f.session.dispose();
});
test("retry retains the same purchase sequence, acknowledgements stop retry, and stale views cannot rewind", async () => {
  const f = fixture();
  await f.session.initialize();
  f.event({
    kind: "message",
    sender: host,
    payload: { kind: "view", view: view() },
  });
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
  f.event({
    kind: "message",
    sender: host,
    payload: {
      kind: "view",
      view: view({ revision: 2, lastSequence: 1, receipt: { sequence: 1 } }),
    },
  });
  expect(f.session.getSnapshot().pending).toBe(false);
  f.event({
    kind: "message",
    sender: host,
    payload: { kind: "view", view: view() },
  });
  expect(f.session.getSnapshot().view?.revision).toBe(2);
  jest.advanceTimersByTime(2000);
  expect(
    f.requests.filter((r) => r.kind === "send" && r.payload.kind === "command"),
  ).toHaveLength(2);
  f.session.dispose();
});
test("a fresh epoch discards the pending old purchase and starts command numbering again", async () => {
  const f = fixture();
  await f.session.initialize();
  f.event({
    kind: "message",
    sender: host,
    payload: { kind: "view", view: view() },
  });
  f.session.command({
    kind: "action" as const,
    name: "buildFacility",
    payload: { facility: { name: "Wind", peakW: 50e6 }, financed: true },
  });
  f.event({
    kind: "message",
    sender: host,
    payload: { kind: "view", view: view({ epoch: "restored", revision: 0 }) },
  });
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
function deliver(f: ReturnType<typeof fixture>, update: Partial<RoomView>) {
  f.event({
    kind: "message",
    sender: host,
    payload: { kind: "view", view: view(update) },
  });
}
function sentCommands(f: ReturnType<typeof fixture>) {
  return f.requests.flatMap((r) =>
    r.kind === "send" && r.payload.kind === "command"
      ? [r.payload.envelope.command]
      : [],
  );
}

test("host silence is transient, updates once, and only a current authoritative view clears it", async () => {
  const f = fixture();
  await f.session.initialize();
  deliver(f, { revision: 2 });
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
  deliver(f, { revision: 1 });
  expect(f.session.getSnapshot().waitingForHost).toBe(true);
  // Paused matches legitimately keep publishing the same revision.
  deliver(f, { revision: 2 });
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
  deliver(f, { revision: 2 });
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
  deliver(f, {
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
  f.worker.onmessage?.({ data } as MessageEvent<WorkerResponse>);
  expect(f.requests.at(-1)).toEqual({ kind: "send", to: guest, payload: data });
  expect(f.session.getSnapshot()).toBe(previous);
  f.session.dispose();
});

test.each(["command", "disconnect"])(
  "host liveness never overwrites or dismisses a real %s error",
  async (source) => {
    const f = fixture();
    await f.session.initialize();
    deliver(
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
    deliver(f, { revision: 2 });
    expect(f.session.getSnapshot().waitingForHost).toBe(false);
    expect(f.session.getSnapshot().error).toBe(error);
    f.session.dispose();
  },
);

test("menu pauses queue behind purchases and rapid closing cannot strand everyone paused", async () => {
  const f = fixture();
  await f.session.initialize();
  deliver(f, { grids: ownGrid() });
  f.session.command({
    kind: "action" as const,
    name: "buildFacility",
    payload: { facility: { name: "Wind", peakW: 50e6 }, financed: true },
  });
  f.session.setActivity("Building power plants");
  expect(sentCommands(f)).toHaveLength(1);
  deliver(f, {
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
  deliver(f, {
    revision: 3,
    lastSequence: 2,
    receipt: { sequence: 2 },
    grids: ownGrid("Building power plants"),
  });
  expect(sentCommands(f).at(-1)).toEqual({ kind: "activity", reason: null });
  deliver(f, {
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
  deliver(f, { grids: ownGrid() });
  f.session.setActivity("Building power plants");
  f.session.setActivity("Leaving match");
  f.session.setActivity("Reading notification");
  deliver(f, {
    revision: 2,
    lastSequence: 1,
    receipt: { sequence: 1 },
    grids: ownGrid("Building power plants"),
  });
  expect(sentCommands(f)).toEqual([
    { kind: "activity", reason: "Building power plants" },
    { kind: "activity", reason: "Reading notification" },
  ]);
  deliver(f, { epoch: "new", revision: 0, grids: ownGrid() });
  expect(sentCommands(f).at(-1)).toEqual({
    kind: "activity",
    reason: "Reading notification",
  });
  f.session.dispose();
});

test("acknowledging an automatic pause does not dismiss its notification", async () => {
  const f = fixture();
  await f.session.initialize();
  deliver(f, {
    lastSequence: 1,
    receipt: { sequence: 1, error: "Not enough cash" },
    grids: ownGrid(),
  });
  f.session.setActivity("Reading notification");
  expect(f.session.getSnapshot().error).toBe("Not enough cash");
  deliver(f, {
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
  deliver(f, { grids: ownGrid() });
  let observed = 0;
  const stop = f.session.subscribe(() => {
    observed = f.session.getSnapshot().view!.lastSequence;
  });
  const first = f.session.submit({ kind: "rate", value: 0.2 });
  const second = f.session.submit({ kind: "speed", speed: "SLOW" });
  expect(sentCommands(f)).toHaveLength(1);
  deliver(f, {
    revision: 2,
    lastSequence: 1,
    receipt: { sequence: 1 },
    grids: ownGrid(),
  });
  await first;
  expect(observed).toBe(1);
  expect(sentCommands(f).at(-1)).toEqual({ kind: "speed", speed: "SLOW" });
  deliver(f, {
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
  deliver(f, { grids: ownGrid() });
  const first = f.session.submit({ kind: "rate", value: 0.2 });
  const ready = f.session.submit({ kind: "ready" });
  const rejected = ready.catch((error: Error) => error.message);
  const last = f.session.submit({ kind: "speed", speed: "SLOW" });
  deliver(f, {
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
  deliver(f, {
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
        } as MessageEvent<WorkerResponse>);
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
    } as MessageEvent<WorkerResponse>);
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
  } as MessageEvent<WorkerResponse>);
  expect(f.session.getSnapshot().view).toBeDefined();
  expect(f.session.getSnapshot().error).toBe("Runtime failed");
  expect(f.worker.terminate).not.toHaveBeenCalled();
  expect(f.requests).not.toContainEqual({ kind: "unlock" });
  f.session.dispose();
});

test("a guest menu save waits for the host's checkpoint acknowledgement", async () => {
  const f = fixture();
  await f.session.initialize();
  deliver(f, {});
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
  deliver(f, { disconnected: [host] });
  await expect(f.session.submit({ kind: "ready" })).rejects.toThrow(
    "reconnect",
  );
  const next = f.session.submit({ kind: "speed", speed: "SLOW" });
  deliver(f, { revision: 2, lastSequence: 1, receipt: { sequence: 1 } });
  await next;
  f.session.dispose();
});

test("a guest whose host cannot save stays in the match and can leave without saving", async () => {
  const f = fixture();
  await f.session.initialize();
  deliver(f, {});
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
  deliver(f, {});
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
  deliver(f, { epoch: "next" });
  const next = f.session.submit({ kind: "speed", speed: "SLOW" });
  expect(sentCommands(f)).toEqual([{ kind: "speed", speed: "SLOW" }]);
  deliver(f, {
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

test("a guest's finished match closes when the host goes back to choosing, and Ready names the selection", async () => {
  const f = fixture();
  await f.session.initialize();
  deliver(f, {});
  expect(f.session.getSnapshot().view).toBeDefined();
  f.event({
    kind: "message",
    sender: host,
    payload: { kind: "browse", browse: browse({ card: "NEW_GAME" }) },
  });
  expect(f.session.getSnapshot().view).toBeUndefined();
  expect(f.session.getSnapshot().browse?.card).toBe("NEW_GAME");
  await f.session.setReady("101|Employee|");
  expect(f.requests.at(-1)).toEqual({
    kind: "member",
    key: "ready",
    value: "101|Employee|",
  });
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
  deliver(f, {});
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
