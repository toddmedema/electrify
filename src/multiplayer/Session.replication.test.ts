import "../Store";
import { TextEncoder } from "util";
import { webcrypto } from "crypto";
import { MultiplayerSession } from "./Session";
import { ReplicaRuntime } from "./ReplicaRuntime";
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
function fixture(replication = true) {
  const events = new Map<string, (event: NativeEvent) => void>();
  const requests: { sender: string; request: NativeRequest }[] = [];
  const posts: WorkerRequest[] = [];
  const replicaPosts: ReplicaRequest[] = [];
  const replicaFactory = jest.fn();
  let source!: ReplicatedWorld;
  let baseline!: ReplicaBaseline;
  let failRecords = false;
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
        if (request.replication) sendBaseline();
        else
          respond({
            kind: "views",
            views: { guest: roomView(source.world, "guest") },
          });
      } else if (request.kind === "baseline") sendBaseline();
      else if (request.kind === "command") {
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
    sendRecords();
    baseline = source.baseline();
    respond({ kind: "baseline", to: "guest", baseline });
    sendRecords();
  };
  const replicaWorker = {
    onmessage: null as ((event: MessageEvent<ReplicaResponse>) => void) | null,
    terminate: jest.fn(),
    postMessage(request: ReplicaRequest) {
      replicaPosts.push(request);
      void runtime.receive(request);
    },
  };
  const runtime = new ReplicaRuntime(
    (data) =>
      void Promise.resolve().then(() =>
        replicaWorker.onmessage?.({ data } as MessageEvent<ReplicaResponse>),
      ),
    async () => {},
    undefined,
    (bytes) => webcrypto.subtle.digest("SHA-256", bytes),
  );
  replicaFactory.mockResolvedValue(replicaWorker as unknown as Worker);
  const host = new MultiplayerSession(
    bridge("host"),
    async () => hostWorker as unknown as Worker,
    undefined,
    () => replication,
  );
  const guest = new MultiplayerSession(
    bridge("guest"),
    jest.fn(),
    replicaFactory,
  );
  const start = async () => {
    await host.initialize();
    await guest.initialize();
    await host.start({ spec: COOP_TEST_SPEC });
    await flush();
  };
  return {
    host,
    guest,
    start,
    posts,
    replicaPosts,
    requests,
    replicaFactory,
    replicaWorker,
    source: () => source,
    baseline: () => baseline,
    state,
    respond,
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
      replication: true,
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
          request.kind === "send" && request.payload.kind === "view",
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

test("the first received view or baseline selects one mode for its epoch, and leave terminates the replica", async () => {
  const f = fixture();
  try {
    await f.start();
    const initial = f.guest.getSnapshot().view!;
    f.event("guest", {
      kind: "message",
      sender: "host",
      payload: { kind: "view", view: { ...initial, revision: 999 } },
    });
    expect(f.guest.getSnapshot().view!.revision).toBe(initial.revision);
    await f.guest.leave({ skipSave: true });
    expect(f.replicaWorker.terminate).toHaveBeenCalledTimes(1);
  } finally {
    f.dispose();
  }
  const snapshot = fixture(false);
  try {
    await snapshot.start();
    const initial = snapshot.guest.getSnapshot().view!;
    snapshot.event("guest", {
      kind: "message",
      sender: "host",
      payload: { kind: "baseline", ...snapshot.source().baseline() },
    });
    await flush();
    expect(snapshot.replicaFactory).not.toHaveBeenCalled();
    expect(snapshot.guest.getSnapshot().view).toBe(initial);
  } finally {
    snapshot.dispose();
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
    jest.advanceTimersByTime(100);
    await flush();
    f.failRecordSend();
    const next = f.guest.submit({ kind: "rate", value: 0.11 });
    await flush();
    jest.advanceTimersByTime(100);
    await flush();
    await next;
    expect(
      f.posts.filter((request) => request.kind === "baseline").length,
    ).toBeGreaterThan(0);
  } finally {
    f.dispose();
  }
});
