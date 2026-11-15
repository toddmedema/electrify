import "../Store";
import { TextEncoder } from "util";
import { webcrypto } from "crypto";
import { MultiplayerSession } from "./Session";
import { ReplicaRuntime } from "./ReplicaRuntime";
import { ReplicaRecovery } from "./ReplicaRecovery";
import { ReplicatedWorld } from "./Replication";
import type { ReplicaBaseline } from "./Replication";
import type { ReplicaRequest, ReplicaResponse } from "./ReplicaProtocol";
import { createWorld, roomView } from "./World";
import type { DesktopBridge } from "../Desktop";
import type { LobbyState, NativeEvent, NativeRequest } from "./Native";
import type { WorkerRequest, WorkerResponse } from "./WorkerProtocol";
import { loadSimData } from "../testing/SimData";
import { COOP_TEST_SPEC } from "../testing/MultiplayerFixtures";

Object.assign(globalThis, { TextEncoder, crypto: webcrypto });
const { parse, stringify } = require("../../electron/coop-codec.cjs");
const flush = async () => {
  for (let n = 0; n < 30; n++) await Promise.resolve();
};
beforeAll(() => loadSimData("SF"));
beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});
function fixture({ recover = false } = {}) {
  const events = new Map<string, (event: NativeEvent) => void>();
  const requests: { sender: string; request: NativeRequest }[] = [];
  const posts: WorkerRequest[] = [];
  const replicaPosts: ReplicaRequest[] = [];
  const replicaResponses: ReplicaResponse[] = [];
  let holdViewCredit = false;
  let heldViewCredit = false;
  const replicaFactory = jest.fn();
  let source!: ReplicatedWorld;
  let baseline!: ReplicaBaseline;
  let failRecords = false;
  let holdCommands = false;
  let recovery: ReplicaRecovery | undefined;
  const seats = [
    { id: "host", name: "Host" },
    { id: "guest", name: "Guest" },
  ];
  const state = (selfId: string): LobbyState => ({
    available: true,
    lobbyId: "lobby",
    hostId: "host",
    selfId,
    members: seats,
    connected: [selfId === "host" ? "guest" : "host"],
  });
  const bridge = (sender: string) =>
    ({
      onMultiplayerEvent(callback: (event: NativeEvent) => void) {
        events.set(sender, callback);
        return () => events.delete(sender);
      },
      async multiplayerRequest(request: NativeRequest) {
        requests.push({ sender, request });
        if (request.kind === "state") return state(sender);
        if (request.kind === "send") {
          if (holdCommands && request.payload.kind === "command") return;
          if (request.payload.kind === "records" && failRecords) {
            failRecords = false;
            throw new Error("Send failed");
          }
          events.get(request.to)?.(
            parse(
              stringify({ kind: "message", sender, payload: request.payload }),
            ),
          );
        }
      },
    }) as unknown as DesktopBridge;
  const hostWorker = {
    onmessage: null as ((event: MessageEvent<WorkerResponse>) => void) | null,
    terminate: jest.fn(),
    postMessage(request: WorkerRequest) {
      posts.push(request);
      if (request.kind === "create") {
        source = new ReplicatedWorld(
          createWorld(
            request.spec,
            request.seats,
            request.matchId,
            request.epoch,
          ),
        );
        respond({
          kind: "views",
          views: { host: roomView(source.world, "host") },
        });
        {
          if (recover)
            recovery = new ReplicaRecovery(source, "host", {
              flush: sendRecords,
              send: (to, value) => {
                baseline = value;
                respond({ kind: "baseline", to, baseline });
              },
              changed: () => {
                sendRecords();
                respond({
                  kind: "views",
                  views: { host: roomView(source.world, "host") },
                });
              },
              error: (error) => {
                throw error;
              },
              digest: (bytes) => webcrypto.subtle.digest("SHA-256", bytes),
            });
          sendBaseline();
        }
      } else if (request.kind === "baseline") sendBaseline();
      else if (request.kind === "replica-peers")
        recovery?.connected(request.connected);
      else if (request.kind === "progress") recovery?.progress(request);
      else if (request.kind === "checkpoint") {
        respond({
          kind: "views",
          views: {
            host: roomView(source.world, "host"),
          },
        });
      } else if (request.kind === "command") {
        const result = source.command(
          request.sender,
          request.envelope,
          request.allowReady,
        );
        if (!result.recorded && result.error)
          respond({
            kind: "rejected",
            to: request.sender,
            matchId: source.world.matchId,
            epoch: source.world.epoch,
            sequence: request.envelope.sequence,
            error: result.error,
          });
        sendRecords();
        respond({
          kind: "views",
          views: { host: roomView(source.world, "host") },
        });
      }
    },
  };
  const respond = (data: WorkerResponse) =>
    void Promise.resolve().then(() =>
      hostWorker.onmessage?.({ data } as MessageEvent<WorkerResponse>),
    );
  const sendRecords = () => {
    const batch = source.drain();
    if (batch)
      respond({
        kind: "records",
        matchId: source.world.matchId,
        epoch: source.world.epoch,
        ...batch,
      });
  };
  const sendBaseline = () => {
    if (recovery) {
      recovery.baseline("guest");
      return;
    }
    sendRecords();
    baseline = source.baseline();
    respond({ kind: "baseline", to: "guest", baseline });
    sendRecords();
  };
  const replicaWorker = {
    onerror: null as (() => void) | null,
    onmessage: null as ((event: MessageEvent<ReplicaResponse>) => void) | null,
    terminate: jest.fn(),
    postMessage(request: ReplicaRequest) {
      replicaPosts.push(request);
      if (holdViewCredit && request.kind === "views-applied") {
        heldViewCredit = true;
        return;
      }
      void runtime.receive(request);
    },
  };
  const runtime = new ReplicaRuntime(
    (data) => {
      replicaResponses.push(data);
      void Promise.resolve().then(() =>
        replicaWorker.onmessage?.({ data } as MessageEvent<ReplicaResponse>),
      );
    },
    async () => {},
    undefined,
    (bytes) => webcrypto.subtle.digest("SHA-256", bytes),
  );
  replicaFactory.mockResolvedValue(replicaWorker as unknown as Worker);
  const host = new MultiplayerSession(
    bridge("host"),
    async () => hostWorker as unknown as Worker,
    replicaFactory,
  );
  const createGuest = () =>
    new MultiplayerSession(bridge("guest"), jest.fn(), replicaFactory);
  let guest = createGuest();
  const start = async () => {
    await host.initialize();
    await guest.initialize();
    await host.start({ spec: COOP_TEST_SPEC });
    await flush();
  };
  return {
    host,
    get guest() {
      return guest;
    },
    start,
    posts,
    replicaPosts,
    replicaResponses,
    holdViewCredit: () => {
      holdViewCredit = true;
    },
    releaseViewCredit: async () => {
      holdViewCredit = false;
      if (heldViewCredit) {
        heldViewCredit = false;
        await runtime.receive({ kind: "views-applied" });
      }
    },
    requests,
    replicaFactory,
    replicaWorker,
    source: () => source,
    baseline: () => baseline,
    state,
    respond,
    holdCommands: () => {
      holdCommands = true;
    },
    releaseCommands: () => {
      holdCommands = false;
    },
    reloadGuest: async () => {
      guest.dispose();
      guest = createGuest();
      await guest.initialize();
    },
    fault: (message: string) => {
      source.pause(message);
      source.fault(message);
      sendRecords();
    },
    event: (id: string, event: NativeEvent) => events.get(id)?.(event),
    failRecordSend: () => {
      failRecords = true;
    },
    dispose: () => {
      host.dispose();
      guest.dispose();
    },
  };
}

test("replica views settle guest commands and errors through existing receipts without remote snapshot views", async () => {
  const f = fixture();
  try {
    await f.start();
    expect(f.posts.find((request) => request.kind === "create")).toMatchObject({
      hostSeat: "host",
    });
    expect(f.guest.getSnapshot()).toMatchObject({
      synchronizing: false,
      view: { lastSequence: 0 },
    });
    expect(f.replicaFactory).toHaveBeenCalledTimes(1);
    expect(
      f.requests.some(
        ({ request }) =>
          request.kind === "send" &&
          (request.payload as { kind: string }).kind === "view",
      ),
    ).toBe(false);
    const accepted = f.guest.submit({ kind: "rate", value: 0.1 });
    await flush();
    jest.advanceTimersByTime(100);
    await flush();
    await accepted;
    expect(f.guest.getSnapshot().view).toMatchObject({
      lastSequence: 1,
      game: { dollarsPerkWh: 0.1 },
    });
    const refused = f.guest.submit({ kind: "rate", value: -1 });
    const error = refused.catch((reason: Error) => reason);
    await flush();
    jest.advanceTimersByTime(100);
    await flush();
    expect(await error).toBeInstanceOf(Error);
    expect(f.guest.getSnapshot()).toMatchObject({
      pending: false,
      view: { lastSequence: 2 },
      error: expect.any(String),
    });
    jest.advanceTimersByTime(500);
    await flush();
    expect(f.posts).toContainEqual(
      expect.objectContaining({
        kind: "progress",
        sender: "guest",
        applied: expect.any(Number),
      }),
    );
  } finally {
    f.dispose();
  }
});

test("retired remote views cannot replace the local replica, and leave terminates it", async () => {
  const f = fixture();
  try {
    await f.start();
    const initial = f.guest.getSnapshot().view!;
    f.event("guest", {
      kind: "message",
      sender: "host",
      payload: { kind: "view", view: { ...initial, revision: 999 } },
    } as unknown as NativeEvent);
    expect(f.guest.getSnapshot().view!.revision).toBe(initial.revision);
    await f.guest.leave({ skipSave: true });
    expect(f.replicaWorker.terminate).toHaveBeenCalledTimes(1);
  } finally {
    f.dispose();
  }
});

test("synchronizing blocks new commands; authenticated keepalives update disconnected companies without clearing errors", async () => {
  const f = fixture();
  try {
    await f.start();
    const world = f.source();
    const baseline = world.baseline();
    f.event("guest", {
      kind: "message",
      sender: "host",
      payload: { kind: "baseline", ...baseline },
    });
    await expect(f.guest.submit({ kind: "ready" })).rejects.toThrow(
      "Synchronizing with host",
    );
    await flush();
    const before = f.guest.getSnapshot().view!;
    f.event("guest", {
      kind: "message",
      sender: "stranger",
      payload: {
        kind: "keepalive",
        matchId: before.matchId,
        epoch: before.epoch,
        revision: 999,
        disconnected: ["host"],
      },
    });
    expect(f.guest.getSnapshot().view!.disconnected).toEqual([]);
    f.event("guest", {
      kind: "message",
      sender: "host",
      payload: {
        kind: "keepalive",
        matchId: before.matchId,
        epoch: before.epoch,
        revision: 999,
        disconnected: ["host"],
      },
    });
    expect(f.guest.getSnapshot().view!.disconnected).toEqual(["host"]);
  } finally {
    f.dispose();
  }
});

test("a pre-consumption rejection resets the pending sequence and a failed record send requests a baseline", async () => {
  const f = fixture();
  try {
    await f.start();
    f.holdCommands();
    const pending = f.guest.submit({ kind: "rate", value: 0.1 });
    const rejected = pending.catch((reason: Error) => reason);
    const view = f.guest.getSnapshot().view!;
    f.event("guest", {
      kind: "message",
      sender: "host",
      payload: {
        kind: "rejected",
        matchId: view.matchId,
        epoch: view.epoch,
        sequence: 1,
        error: "Wrong epoch",
      },
    });
    expect(await rejected).toEqual(new Error("Wrong epoch"));
    expect(f.guest.getSnapshot().pending).toBe(false);
    await flush();
    expect(
      f.posts.filter((request) => request.kind === "command"),
    ).toHaveLength(0);
    f.releaseCommands();
    f.failRecordSend();
    const next = f.guest
      .submit({ kind: "rate", value: 0.11 })
      .catch((error: Error) => error);
    const command = f.requests
      .filter(
        ({ request }) =>
          request.kind === "send" && request.payload.kind === "command",
      )
      .at(-1)!.request;
    expect(command).toMatchObject({ payload: { envelope: { sequence: 1 } } });
    await flush();
    jest.advanceTimersByTime(100);
    await flush();
    expect(await next).toBeUndefined();
    expect(
      f.posts.filter((request) => request.kind === "baseline").length,
    ).toBeGreaterThan(0);
  } finally {
    f.dispose();
  }
});

test("a failed replica worker is replaced for a same-stream recovery baseline", async () => {
  const f = fixture();
  const replacementPosts: ReplicaRequest[] = [];
  const replacement = {
    onmessage: null as ((event: MessageEvent<ReplicaResponse>) => void) | null,
    terminate: jest.fn(),
    postMessage(request: ReplicaRequest) {
      replacementPosts.push(request);
      void runtime.receive(request);
    },
  };
  const runtime = new ReplicaRuntime(
    (data) =>
      replacement.onmessage?.({ data } as MessageEvent<ReplicaResponse>),
    async () => {},
    undefined,
    (bytes) => webcrypto.subtle.digest("SHA-256", bytes),
  );
  try {
    await f.start();
    f.replicaFactory.mockResolvedValueOnce(replacement as unknown as Worker);
    const obsoleteError = f.replicaWorker.onerror!;
    expect(obsoleteError).toEqual(expect.any(Function));
    obsoleteError();
    expect(f.replicaWorker.terminate).toHaveBeenCalledTimes(1);
    expect(f.guest.getSnapshot().synchronizing).toBe(true);
    const baseline = f.source().baseline();
    f.event("guest", {
      kind: "message",
      sender: "host",
      payload: { kind: "baseline", ...baseline },
    });
    await flush();
    expect(f.replicaFactory).toHaveBeenCalledTimes(2);
    expect(replacementPosts).toContainEqual(
      expect.objectContaining({
        kind: "baseline",
        baseline: expect.objectContaining({
          matchId: baseline.matchId,
          epoch: baseline.epoch,
          index: baseline.index,
        }),
      }),
    );
    expect(f.guest.getSnapshot()).toMatchObject({
      synchronizing: false,
      view: { matchId: baseline.matchId, epoch: baseline.epoch },
    });
    obsoleteError();
    expect(f.guest.getSnapshot().synchronizing).toBe(false);
    expect(replacement.terminate).not.toHaveBeenCalled();
  } finally {
    f.dispose();
  }
});

test("a paused snapshot reconnect receives the current company and command receipt", async () => {
  const f = fixture({ replication: false });
  try {
    await f.start();
    const initial = f.guest.getSnapshot().view!;
    f.event("host", {
      kind: "state",
      state: { ...f.state("host"), connected: [] },
    });
    expect(
      f.source().command("guest", {
        matchId: initial.matchId,
        epoch: initial.epoch,
        sequence: 1,
        command: { kind: "rate", value: 0.11 },
      }).recorded,
    ).toBe(true);
    f.event("host", { kind: "state", state: f.state("host") });
    await flush();
    expect(f.guest.getSnapshot().view).toMatchObject({
      speed: "PAUSED",
      lastSequence: 1,
      receipt: { sequence: 1 },
      game: { dollarsPerkWh: 0.11 },
    });
  } finally {
    f.dispose();
  }
});

test("a reloaded replica reconnect receives a baseline after real recovery membership is restored", async () => {
  const f = fixture({ recover: true });
  try {
    await f.start();
    expect(f.guest.getSnapshot().view).toBeDefined();
    f.event("host", {
      kind: "state",
      state: { ...f.state("host"), connected: [] },
    });
    await flush();
    await f.reloadGuest();
    expect(f.guest.getSnapshot().view).toBeUndefined();
    f.event("host", { kind: "state", state: f.state("host") });
    await flush();
    expect(f.guest.getSnapshot()).toMatchObject({
      synchronizing: false,
      view: { matchId: f.source().world.matchId, speed: "PAUSED" },
    });
    expect(f.replicaFactory).toHaveBeenCalledTimes(2);
  } finally {
    f.dispose();
  }
});

test.each([true, false])(
  "a terminal replica publishes its stopped clock, settles consumed=%s work, and rejects further commands",
  async (consumed) => {
    const f = fixture();
    try {
      await f.start();
      const hostReady = f.host.submit({ kind: "ready" });
      const guestReady = f.guest.submit({ kind: "ready" });
      await flush();
      jest.advanceTimersByTime(100);
      await flush();
      await Promise.all([hostReady, guestReady]);
      expect(f.guest.getSnapshot().view).toMatchObject({
        speed: "NORMAL",
        readyRequired: false,
      });
      if (!consumed) f.holdCommands();
      const pending = f.guest
        .submit({ kind: "rate", value: 0.12 })
        .catch((error: Error) => error);
      const queued = f.guest
        .submit({ kind: "rate", value: 0.13 })
        .catch((error: Error) => error);
      await flush();
      expect(f.guest.getSnapshot().pending).toBe(true);
      f.fault("Simulation stopped");
      await flush();
      jest.advanceTimersByTime(100);
      await flush();
      expect(f.guest.getSnapshot()).toMatchObject({
        synchronizing: false,
        waitingForHost: false,
        pending: false,
        error: "Simulation stopped",
        view: {
          speed: "PAUSED",
          readyRequired: true,
          ready: [],
          reason: "Simulation stopped",
        },
      });
      expect(await pending).toEqual(
        consumed ? undefined : new Error("Simulation stopped"),
      );
      expect(await queued).toEqual(new Error("Simulation stopped"));
      const commands = () =>
        f.requests.filter(
          ({ request }) =>
            request.kind === "send" && request.payload.kind === "command",
        ).length;
      const sent = commands();
      await expect(f.guest.submit({ kind: "ready" })).rejects.toThrow(
        "Simulation stopped",
      );
      f.guest.setActivity("menu");
      jest.advanceTimersByTime(11000);
      await flush();
      expect(commands()).toBe(sent);
      expect(f.guest.getSnapshot()).toMatchObject({
        synchronizing: false,
        waitingForHost: false,
      });
    } finally {
      f.dispose();
    }
  },
);

test("a terminal projection waits for the previous view credit and a new match clears the terminal state", async () => {
  const f = fixture();
  try {
    await f.start();
    f.holdViewCredit();
    const ready = f.guest.submit({ kind: "ready" });
    await flush();
    jest.advanceTimersByTime(100);
    await flush();
    await ready;
    expect(f.guest.getSnapshot().view!.ready).toEqual(["guest"]);
    const projections = () =>
      f.replicaResponses.filter((response) => response.kind === "views").length;
    const sent = projections();
    f.fault("Simulation stopped");
    await flush();
    jest.advanceTimersByTime(100);
    await flush();
    expect(projections()).toBe(sent);
    expect(f.guest.getSnapshot()).toMatchObject({
      synchronizing: false,
      error: "Simulation stopped",
    });
    await f.releaseViewCredit();
    await flush();
    expect(projections()).toBe(sent + 1);
    expect(f.guest.getSnapshot().view).toMatchObject({
      ready: [],
      speed: "PAUSED",
      reason: "Simulation stopped",
    });
    await f.host.start({ spec: COOP_TEST_SPEC });
    await flush();
    expect(f.guest.getSnapshot().error).toBeUndefined();
    expect(f.guest.getSnapshot().synchronizing).toBe(false);
    const accepted = f.guest.submit({ kind: "rate", value: 0.1 });
    await flush();
    jest.advanceTimersByTime(100);
    await flush();
    await accepted;
    expect(f.guest.getSnapshot().view).toMatchObject({
      lastSequence: 1,
      game: { dollarsPerkWh: 0.1 },
    });
  } finally {
    f.dispose();
  }
});
