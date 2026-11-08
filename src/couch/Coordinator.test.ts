import "../Store";
import cloneDeep from "lodash.clonedeep";
import { loadSimData } from "../testing/SimData";
import { COOP_TEST_SPEC } from "../testing/MultiplayerFixtures";
import {
  applyCommand,
  checkpointWorld,
  createWorld,
  roomView,
  setWorldBlockers,
  pauseWorld,
  stepWorld,
} from "../multiplayer/World";
import type { World } from "../multiplayer/Types";
import type {
  WorkerRequest,
  WorkerResponse,
} from "../multiplayer/WorkerProtocol";
import { CouchCoordinator } from "./Coordinator";
import { CouchClient } from "./Client";
import type { CouchSummary, SeatEvent } from "./Protocol";

beforeAll(() => loadSimData("SF"));
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});
const seats = [
  { id: "local-p1", name: "Ada" },
  { id: "local-p2", name: "Grace" },
];

function fixture(
  persist = jest.fn().mockResolvedValue(undefined),
  onSeatLost = jest.fn(),
  onAccountView = jest.fn(),
  onMenu = jest.fn(),
  onSharedView = jest.fn(),
  onSettings = jest.fn(),
) {
  jest.useFakeTimers();
  let world: World;
  const posts: WorkerRequest[] = [];
  const emit = (data: WorkerResponse) =>
    worker.onmessage?.({ data } as MessageEvent<WorkerResponse>);
  const publish = () =>
    emit({
      kind: "views",
      views: Object.fromEntries(
        seats.map((seat) => [seat.id, roomView(world, seat.id)]),
      ),
    });
  const worker = {
    onmessage: null as ((message: MessageEvent<WorkerResponse>) => void) | null,
    onerror: null as (() => void) | null,
    terminate: jest.fn(),
    postMessage(request: WorkerRequest) {
      posts.push(request);
      if (request.kind === "create") {
        world = createWorld(
          request.spec,
          request.seats,
          request.matchId,
          request.epoch,
        );
        publish();
      } else if (request.kind === "command") {
        applyCommand(
          world,
          request.sender,
          request.envelope,
          request.allowReady,
        );
        publish();
      } else if (request.kind === "blockers") {
        if (request.requireReady)
          pauseWorld(world, request.readyReason || "Ready up");
        setWorldBlockers(world, request.reasons);
        publish();
      } else if (request.kind === "checkpoint") {
        if (request.pause) pauseWorld(world, "Saved and paused");
        emit({
          kind: "checkpoint",
          world: cloneDeep(checkpointWorld(world)),
          requestId: request.requestId,
        });
      } else if (request.kind === "disconnect") {
        pauseWorld(world, "Disconnected");
        publish();
      }
    },
  };
  const coordinator = new CouchCoordinator(worker as unknown as Worker, {
    persist,
    onSeatLost,
    onAccountView,
    onMenu,
    onSharedView,
    onSettings,
  });
  const messages: Record<string, SeatEvent[]> = {};
  const clients = seats.map((seat) => {
    const client = new CouchClient(seat.id, 1, (message) =>
      coordinator.receive(seat.id, 1, message),
    );
    messages[seat.id] = [];
    coordinator.attachSeat(seat.id, 1, (event) => {
      messages[seat.id].push(event);
      client.receive(event);
    });
    return client;
  });
  coordinator.start(COOP_TEST_SPEC, seats, "match", "epoch");
  const dispose = () => {
    clients.forEach((client) => client.dispose());
    coordinator.dispose();
  };
  return {
    coordinator,
    clients,
    posts,
    worker,
    emit,
    publish,
    messages,
    persist,
    onSeatLost,
    onAccountView,
    onMenu,
    onSharedView,
    onSettings,
    world: () => world,
    dispose,
  };
}

it("uses independent sequence one commands for simultaneous seat actions and rejects forged/stale routes", async () => {
  const f = fixture();
  try {
    await Promise.all(
      f.clients.map((client, i) =>
        client.submit({ kind: "rate", value: 0.1 + i * 0.01 }),
      ),
    );
    expect(f.world().sequences).toEqual({ "local-p1": 1, "local-p2": 1 });
    expect(f.world().grids.map((grid) => grid.dollarsPerkWh)).toEqual([
      0.1, 0.11,
    ]);
    const valid = {
      kind: "command",
      matchId: "match",
      epoch: "epoch",
      sequence: 2,
      command: { kind: "rate", value: 0.12 },
    };
    expect(
      f.coordinator.receive("local-p1", 1, { ...valid, sender: "local-p2" }),
    ).toBe(false);
    expect(f.coordinator.receive("local-p1", 0, valid)).toBe(false);
    expect(f.coordinator.receive("unknown", 1, valid)).toBe(false);
    expect(
      f.coordinator.receive("local-p1", 1, { ...valid, epoch: "old" }),
    ).toBe(false);
    expect(f.world().grids.map((grid) => grid.dollarsPerkWh)).toEqual([
      0.1, 0.11,
    ]);
    expect(f.coordinator.receive("local-p1", 1, valid)).toBe(true);
    expect(f.world().grids.map((grid) => grid.dollarsPerkWh)).toEqual([
      0.12, 0.11,
    ]);
  } finally {
    f.dispose();
  }
});

it("applies a retried purchase once and still permits a purchase while the clock is paused", async () => {
  const f = fixture();
  try {
    const before = f.world().grids.map((grid) => grid.facilities.length);
    const command = {
      kind: "action" as const,
      name: "buildFacility",
      payload: { facility: { name: "Wind", peakW: 50e6 }, financed: true },
    };
    await f.clients[0].submit(command);
    const sent = f.posts.find(
      (post): post is Extract<WorkerRequest, { kind: "command" }> =>
        post.kind === "command" && post.envelope.command.kind === "action",
    )!;
    expect(f.world().grids.map((grid) => grid.facilities.length)).toEqual([
      before[0] + 1,
      before[1],
    ]);
    f.coordinator.receive("local-p1", 1, { kind: "command", ...sent.envelope });
    expect(f.world().grids[0].facilities).toHaveLength(before[0] + 1);
    expect(f.world().speed).toBe("PAUSED");
  } finally {
    f.dispose();
  }
});

it("composes shell blockers and needs fresh consent after recovery, without economic catch-up", async () => {
  const f = fixture();
  try {
    await Promise.all(
      f.clients.map((client) =>
        client.submit({ kind: "speed", speed: "FAST" }),
      ),
    );
    expect(f.world().speed).toBe("FAST");
    f.coordinator.setBlocker("overlay", "Steam overlay");
    f.coordinator.setBlocker("background", "Game in background", true);
    expect(f.coordinator.getSnapshot().blockers).toEqual([
      "Steam overlay",
      "Game in background",
    ]);
    expect(f.world().speed).toBe("PAUSED");
    const minute = f.world().grids[0].date.minute;
    stepWorld(f.world());
    expect(f.world().grids[0].date.minute).toBe(minute);
    f.coordinator.setBlocker("overlay", null);
    expect(f.coordinator.getSnapshot().blockers).toEqual([
      "Game in background",
    ]);
    expect(f.world().speed).toBe("PAUSED");
    expect(f.world().selectedSpeeds).toEqual({
      "local-p1": "FAST",
      "local-p2": "FAST",
    });
    f.coordinator.setBlocker("background", null);
    expect(f.world().speed).toBe("PAUSED");
    await f.clients[0].submit({ kind: "speed", speed: "FAST" });
    expect(f.world().speed).toBe("PAUSED");
    await f.clients[1].submit({ kind: "speed", speed: "NORMAL" });
    expect(f.world().speed).toBe("NORMAL");
  } finally {
    f.dispose();
  }
});

it("keeps only an in-flight view and the newest replacement for a slow seat", async () => {
  const f = fixture();
  try {
    const slow: SeatEvent[] = [];
    f.coordinator.attachSeat("local-p2", 2, (event) => slow.push(event));
    const first = slow.find((event) => event.kind === "view")! as Extract<
      SeatEvent,
      { kind: "view" }
    >;
    for (let i = 0; i < 20; i++) {
      f.world().revision++;
      f.publish();
    }
    expect(slow.filter((event) => event.kind === "view")).toHaveLength(1);
    f.coordinator.receive("local-p2", 2, {
      kind: "ack",
      delivery: first.delivery,
    });
    const views = slow.filter(
      (event): event is Extract<SeatEvent, { kind: "view" }> =>
        event.kind === "view",
    );
    expect(views).toHaveLength(2);
    expect(views[1].view.revision).toBe(f.world().revision);
    expect(f.coordinator.receive("local-p2", 1, { kind: "heartbeat" })).toBe(
      false,
    );
  } finally {
    f.dispose();
  }
});

it("excludes retired companies from controller recovery blockers", async () => {
  const f = fixture();
  try {
    f.coordinator.detachSeat("local-p2", 1);
    f.emit({
      kind: "summary",
      summary: {
        players: seats.map((seat, i) => ({ ...seat, retired: i === 1 })),
      } as CouchSummary,
    });
    f.world().outcomes["local-p2"] = {
      outcome: "bankrupt",
      title: "Bankrupt",
      month: 0,
    };
    f.publish();
    await f.clients[0].submit({ kind: "speed", speed: "NORMAL" });
    expect(f.world().speed).toBe("NORMAL");
  } finally {
    f.dispose();
  }
});

it("saves a complete FIFO command barrier and acknowledges only the successful durable write", async () => {
  let finish = () => {};
  const persist = jest.fn().mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const f = fixture(persist);
  try {
    await f.clients[0].submit({ kind: "rate", value: 0.12 });
    let saved = false;
    const save = f.coordinator.save(true).then(() => {
      saved = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(persist).toHaveBeenCalledTimes(1);
    const checkpoint = persist.mock.calls[0][0] as World;
    expect(checkpoint.grids).toHaveLength(2);
    expect(checkpoint.receipts["local-p1"].sequence).toBe(1);
    expect(checkpoint.grids[0].dollarsPerkWh).toBe(0.12);
    expect(saved).toBe(false);
    await expect(
      f.clients[1].submit({ kind: "rate", value: 0.15 }),
    ).rejects.toThrow("not accepting");
    finish();
    await save;
    expect(saved).toBe(true);
    expect(f.coordinator.getSnapshot().lastSavedAt).toBeDefined();
  } finally {
    f.dispose();
  }
});

it("keeps the live match retryable after a failed local save", async () => {
  const persist = jest
    .fn()
    .mockRejectedValueOnce(new Error("Disk full"))
    .mockResolvedValue(undefined);
  const f = fixture(persist);
  try {
    await expect(f.coordinator.save(true)).rejects.toThrow("Disk full");
    expect(f.coordinator.getSnapshot()).toMatchObject({
      phase: "playing",
      closing: false,
      error: "Local save failed: Disk full",
    });
    await f.clients[1].submit({ kind: "rate", value: 0.13 });
    await f.coordinator.save();
    expect(persist).toHaveBeenCalledTimes(2);
    expect(f.coordinator.getSnapshot().lastSavedAt).toBeDefined();
  } finally {
    f.dispose();
  }
});

it("does not reset readiness or flood the worker for unchanged blocker samples", async () => {
  const f = fixture();
  try {
    f.coordinator.setBlocker("controller:local-p2", "Grace disconnected", true);
    const count = f.posts.length;
    for (let i = 0; i < 30; i++)
      f.coordinator.setBlocker(
        "controller:local-p2",
        "Grace disconnected",
        true,
      );
    expect(f.posts).toHaveLength(count);
    f.coordinator.setBlocker("controller:local-p2", null);
    await Promise.all(
      f.clients.map((client) =>
        client.submit({ kind: "speed", speed: "NORMAL" }),
      ),
    );
    expect(f.world().speed).toBe("NORMAL");
    f.coordinator.setBlocker("global-dialog", "P1 reviewing settings");
    expect(f.world().speed).toBe("PAUSED");
    f.coordinator.setBlocker("global-dialog", null);
    expect(f.world().speed).toBe("NORMAL");
  } finally {
    f.dispose();
  }
});

it("does not resolve a save as successful after the session has ended", async () => {
  let finish = () => {};
  const persist = jest.fn().mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const f = fixture(persist);
  const save = f.coordinator.save(true);
  const outcome = save.then(
    () => "saved",
    (error: Error) => error.message,
  );
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  f.dispose();
  finish();
  expect(await outcome).toContain("local session ended");
  expect(f.coordinator.getSnapshot().lastSavedAt).toBeUndefined();
});

it("rejects new operations behind a global input gate without consuming their command sequence", async () => {
  const f = fixture();
  try {
    await f.clients[0].submit({ kind: "rate", value: 0.12 });
    f.coordinator.setInputGate("save-dialog", true);
    await expect(
      f.clients[0].submit({ kind: "rate", value: 0.15 }),
    ).rejects.toThrow("not applied");
    expect(f.world().grids[0].dollarsPerkWh).toBe(0.12);
    expect(f.world().sequences["local-p1"]).toBe(1);
    f.coordinator.setInputGate("save-dialog", false);
    await f.clients[0].submit({ kind: "rate", value: 0.14 });
    expect(f.world().grids[0].dollarsPerkWh).toBe(0.14);
    expect(f.world().sequences["local-p1"]).toBe(2);
  } finally {
    f.dispose();
  }
});

it("an earlier failing autosave cannot reopen a newer Save & Quit barrier", async () => {
  let fail = (_error: Error) => {};
  let finish = () => {};
  const persist = jest
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          fail = reject;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
  const f = fixture(persist);
  try {
    f.emit({
      kind: "checkpoint",
      world: cloneDeep(checkpointWorld(f.world())),
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const saved = f.coordinator.save(true);
    fail(new Error("Earlier autosave failed"));
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(f.coordinator.getSnapshot().closing).toBe(true);
    expect(f.clients[0].getSnapshot().closing).toBe(true);
    await expect(
      f.clients[0].submit({ kind: "rate", value: 0.13 }),
    ).rejects.toThrow("not accepting");
    finish();
    await saved;
  } finally {
    f.dispose();
  }
});

it("retains an applied command's error receipt when newer ordinary views replace it", () => {
  const f = fixture();
  try {
    const events: SeatEvent[] = [];
    f.coordinator.attachSeat("local-p1", 2, (event) => events.push(event));
    const baseline = events.find((event) => event.kind === "view")! as Extract<
      SeatEvent,
      { kind: "view" }
    >;
    f.coordinator.receive("local-p1", 2, {
      kind: "command",
      matchId: "match",
      epoch: "epoch",
      sequence: 1,
      command: {
        kind: "action",
        name: "buildFacility",
        payload: {
          facility: { name: "Invented plant", peakW: 50e6 },
          financed: true,
        },
      },
    });
    const receipt = f.world().receipts["local-p1"];
    expect(receipt.error).toBeDefined();
    f.world().revision++;
    f.publish();
    f.coordinator.receive("local-p1", 2, {
      kind: "ack",
      delivery: baseline.delivery,
    });
    const views = events.filter(
      (event): event is Extract<SeatEvent, { kind: "view" }> =>
        event.kind === "view",
    );
    expect(views).toHaveLength(2);
    expect(views[1].view.receipt).toEqual(receipt);
    expect(views[1].view.lastSequence).toBe(1);
  } finally {
    f.dispose();
  }
});

it("rejects attachment of companies outside the frozen roster", () => {
  const f = fixture();
  try {
    expect(() => f.coordinator.attachSeat("local-p3", 1, () => {})).toThrow(
      "Invalid local seat route",
    );
    expect(f.coordinator.receive("local-p3", 1, { kind: "heartbeat" })).toBe(
      false,
    );
  } finally {
    f.dispose();
  }
});

it("allows initial simulation data loading beyond the active-seat five-second heartbeat threshold", () => {
  jest.useFakeTimers();
  const worker = {
    postMessage: jest.fn(),
    terminate: jest.fn(),
  } as unknown as Worker;
  const coordinator = new CouchCoordinator(worker, {
    persist: jest.fn().mockResolvedValue(undefined),
  });
  try {
    coordinator.start(COOP_TEST_SPEC, seats, "match", "epoch");
    jest.advanceTimersByTime(5500);
    expect(coordinator.getSnapshot().phase).toBe("starting");
    jest.advanceTimersByTime(56000);
    expect(coordinator.getSnapshot().phase).toBe("faulted");
  } finally {
    coordinator.dispose();
  }
});

it("surfaces a renderer heartbeat timeout to the shell recovery owner exactly once", () => {
  const f = fixture();
  try {
    // The renderer is hung while its controller and native view remain present.
    f.clients[1].dispose();
    jest.advanceTimersByTime(5000);
    f.emit({
      kind: "keepalive",
      matchId: "match",
      epoch: "epoch",
      revision: f.world().revision,
    });
    jest.advanceTimersByTime(500);
    expect(f.onSeatLost).toHaveBeenCalledTimes(1);
    expect(f.onSeatLost).toHaveBeenCalledWith(
      "local-p2",
      1,
      "Controller or renderer stopped responding",
    );
    expect(f.world().speed).toBe("PAUSED");
    expect(f.coordinator.receive("local-p2", 1, { kind: "heartbeat" })).toBe(
      false,
    );
    jest.advanceTimersByTime(500);
    expect(f.onSeatLost).toHaveBeenCalledTimes(1);
    expect(f.coordinator.attachSeat("local-p2", 2, () => {})).toBe(true);
    expect(f.coordinator.receive("local-p2", 2, { kind: "heartbeat" })).toBe(
      true,
    );
    expect(f.world().readyRequired).toBe(true);
  } finally {
    f.dispose();
  }
});

it("publishes authoritative P1 account state while its renderer has an unacknowledged view", async () => {
  const f = fixture();
  try {
    const slow: SeatEvent[] = [];
    f.coordinator.attachSeat("local-p1", 2, (event) => slow.push(event));
    const before = f.onAccountView.mock.calls.length;
    for (const rate of [0.11, 0.12, 0.13])
      await f.clients[1].submit({ kind: "rate", value: rate });
    expect(slow.filter((event) => event.kind === "view")).toHaveLength(1);
    expect(f.onAccountView).toHaveBeenCalledTimes(before + 3);
    const latest = f.onAccountView.mock.calls.at(-1)![0];
    expect(latest.revision).toBe(f.world().revision);
    expect(latest.game.multiplayer.seat).toBe("local-p1");
  } finally {
    f.dispose();
  }
});

it("routes each shared speed selector through its owning queue and preserves independent sequence receipts", async () => {
  const f = fixture();
  try {
    await f.clients[0].submit({ kind: "rate", value: 0.11 });
    expect(
      f.coordinator.commandForSeat("local-p1", {
        kind: "speed",
        speed: "FAST",
      }),
    ).toBe(true);
    expect(
      f.coordinator.commandForSeat("local-p2", {
        kind: "speed",
        speed: "NORMAL",
      }),
    ).toBe(true);
    await Promise.resolve();
    expect(f.world().selectedSpeeds).toEqual({
      "local-p1": "FAST",
      "local-p2": "NORMAL",
    });
    expect(f.world().speed).toBe("NORMAL");
    expect(f.world().sequences).toEqual({ "local-p1": 2, "local-p2": 1 });
    expect(f.world().receipts["local-p1"].sequence).toBe(2);
    expect(f.world().receipts["local-p2"].sequence).toBe(1);
    expect(
      f.coordinator.commandForSeat("unknown", { kind: "speed", speed: "FAST" }),
    ).toBe(false);
    f.clients[0].receive({
      kind: "shell-command",
      generation: 1,
      matchId: "match",
      epoch: "old",
      command: { kind: "speed", speed: "ULTRA" },
    });
    f.clients[0].receive({
      kind: "shell-command",
      generation: 0,
      matchId: "match",
      epoch: "epoch",
      command: { kind: "speed", speed: "ULTRA" },
    });
    expect(f.world().selectedSpeeds["local-p1"]).toBe("FAST");
    f.coordinator.setInputGate("global-menu", true);
    expect(
      f.coordinator.commandForSeat("local-p2", {
        kind: "speed",
        speed: "ULTRA",
      }),
    ).toBe(false);
    expect(f.world().selectedSpeeds["local-p2"]).toBe("NORMAL");
  } finally {
    f.dispose();
  }
});

it("authenticates a global menu request by its bound seat and rejects forged or stale owners", () => {
  const f = fixture();
  try {
    expect(
      f.coordinator.receive("local-p2", 1, {
        kind: "global-menu",
        requestId: "menu-2",
      }),
    ).toBe(true);
    expect(f.onMenu).toHaveBeenCalledWith("local-p2", 1, "menu-2");
    expect(
      f.coordinator.receive("local-p2", 0, {
        kind: "global-menu",
        requestId: "stale",
      }),
    ).toBe(false);
    expect(
      f.coordinator.receive("local-p1", 1, {
        kind: "global-menu",
        requestId: "forged",
        sender: "local-p2",
      }),
    ).toBe(false);
    expect(f.onMenu).toHaveBeenCalledTimes(1);
  } finally {
    f.dispose();
  }
});

it("retains the first active company when only another company's view is published", () => {
  const f = fixture();
  try {
    const shared = f.onSharedView.mock.calls.at(-1)![0];
    const calls = f.onSharedView.mock.calls.length;
    f.emit({
      kind: "views",
      views: { "local-p2": roomView(f.world(), "local-p2") },
    });
    expect(f.onSharedView).toHaveBeenCalledTimes(calls);
    expect(f.onSharedView.mock.calls.at(-1)![0]).toBe(shared);
    f.emit({
      kind: "views",
      views: { "local-p1": roomView(f.world(), "local-p1") },
    });
    expect(f.onSharedView).toHaveBeenCalledTimes(calls + 1);
    expect(f.onSharedView.mock.calls.at(-1)![0].game.multiplayer.seat).toBe(
      "local-p1",
    );
  } finally {
    f.dispose();
  }
});

it("keeps shared presentation on an active company after P1 retires without changing account attribution", () => {
  const f = fixture();
  try {
    expect(f.onSharedView.mock.calls.at(-1)![0].game.multiplayer.seat).toBe(
      "local-p1",
    );
    f.world().outcomes["local-p1"] = {
      outcome: "bankrupt",
      title: "Bankrupt",
      month: 0,
    };
    f.publish();
    expect(f.onSharedView.mock.calls.at(-1)![0].game.multiplayer.seat).toBe(
      "local-p2",
    );
    expect(f.onAccountView.mock.calls.at(-1)![0].game.multiplayer.seat).toBe(
      "local-p1",
    );
    const calls = f.onSharedView.mock.calls.length;
    f.emit({
      kind: "views",
      views: { "local-p1": roomView(f.world(), "local-p1") },
    });
    expect(f.onSharedView).toHaveBeenCalledTimes(calls);
    f.world().outcomes["local-p2"] = {
      outcome: "bankrupt",
      title: "Bankrupt",
      month: 0,
    };
    f.publish();
    expect(f.onSharedView.mock.calls.at(-1)![0].game.multiplayer.seat).toBe(
      "local-p1",
    );
  } finally {
    f.dispose();
  }
});

it.each(["global-menu", "global-settings"] as const)(
  "accepts %s only during live play outside the closing checkpoint",
  async (kind) => {
    const f = fixture();
    const callback = kind === "global-menu" ? f.onMenu : f.onSettings;
    const request = { kind, requestId: "global-request" };
    let saving: Promise<void> | undefined;
    try {
      expect(f.coordinator.receive("local-p2", 0, request)).toBe(false);
      expect(
        f.coordinator.receive("local-p2", 1, {
          ...request,
          sender: "local-p1",
        }),
      ).toBe(false);
      expect(f.coordinator.receive("local-p2", 1, request)).toBe(true);
      expect(callback).toHaveBeenCalledTimes(1);
      saving = f.coordinator.save(true);
      expect(f.coordinator.getSnapshot().closing).toBe(true);
      expect(f.coordinator.receive("local-p2", 1, request)).toBe(false);
      expect(callback).toHaveBeenCalledTimes(1);
      await saving;
      f.worker.onerror?.();
      expect(f.coordinator.getSnapshot().phase).toBe("faulted");
      expect(f.coordinator.receive("local-p2", 1, request)).toBe(false);
      expect(callback).toHaveBeenCalledTimes(1);
    } finally {
      await saving?.catch(() => {});
      f.dispose();
    }
  },
);
