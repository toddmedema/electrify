import { TextEncoder } from "util";
import { webcrypto } from "crypto";
import manifest from "../data/RunCompatibility.json";
import { TICK_MS } from "../Constants";
import type { SpeedType } from "../Types";
import type { World } from "../multiplayer/Types";
import type { WorkerRequest } from "../multiplayer/WorkerProtocol";
import { SAVE_SCHEMA_VERSION } from "../SaveSchema";

jest.mock("../data/Economy", () => ({
  initEconomy: (done: () => void) => done(),
}));
jest.mock("../data/FuelPrices", () => ({
  initFuelPrices: (done: () => void) => done(),
}));
jest.mock("../data/Weather", () => ({
  initWeather: jest.fn((_location: unknown, done: () => void) => done()),
}));
jest.mock("../helpers/ScenarioChoices", () => ({
  ...jest.requireActual("../helpers/ScenarioChoices"),
  pendingScenarioChoice: jest.fn(),
}));
jest.mock("../multiplayer/World", () => {
  const blockers = new WeakMap<World, string[]>();
  const roomView = jest.fn((_world: World, _seatId: string) => ({}));
  return {
    createWorld: jest.fn(),
    matchScenario: jest.fn(() => ({ location: { id: "SF" } })),
    restoreWorld: jest.fn(),
    savedMatchSpec: jest.requireActual("../multiplayer/World").savedMatchSpec,
    applyCommand: jest.fn(),
    stepWorld: jest.fn(),
    roomView,
    roomViewBuilder: (world: World) => (seatId: string) =>
      roomView(world, seatId),
    checkpointWorld: (world: World) => world,
    worldBlockers: (world: World) => blockers.get(world) || [],
    setWorldBlockers: (world: World, reasons: string[]) => {
      blockers.set(world, [...reasons]);
    },
    pauseWorld: (world: World, reason: string) => {
      world.speed = "PAUSED";
      world.paused = true;
      world.reason = reason;
    },
  };
});

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  Object.assign(globalThis, { TextEncoder, crypto: webcrypto });
});

test("the host worker schedules every tick at the shared speed and reschedules speed changes", async () => {
  jest.useFakeTimers();
  const scope = globalThis as unknown as Worker;
  const previousMessage = scope.onmessage;
  const previousFetch = globalThis.fetch;
  const post = jest.spyOn(scope, "postMessage").mockImplementation(() => {});
  const timeout = jest.spyOn(globalThis, "setTimeout");
  const { createWorld, applyCommand, stepWorld } = jest.requireMock(
    "../multiplayer/World",
  );
  const world = {
    speed: "PAUSED",
    paused: true,
    seats: [{ id: "host" }],
  } as World;
  let ticks = 0;
  createWorld.mockReturnValue(world);
  stepWorld.mockImplementation(() => {
    if (!world.paused) ticks++;
  });
  applyCommand.mockImplementation(
    (
      target: World,
      _sender: string,
      envelope: { command: { speed: SpeedType } },
    ) => {
      target.speed = envelope.command.speed;
      target.paused = target.speed === "PAUSED";
    },
  );
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(0),
  });
  try {
    require("./Multiplayer.worker");
    const send = async (data: WorkerRequest) =>
      scope.onmessage!({ data } as MessageEvent<WorkerRequest>);
    await send({
      kind: "create",
      hostSeat: "host",
      spec: { scenarioId: 101, difficulty: "Employee" },
      seats: [{ id: "host", name: "Host" }],
      matchId: "match",
      epoch: "epoch",
    });
    const { desktopSimulationHooks } =
      require("../achievements/SimulationHooks") as typeof import("../achievements/SimulationHooks");
    expect(desktopSimulationHooks()).toBeUndefined();
    expect(ticks).toBe(0);
    for (const [sequence, speed] of (
      ["SLOW", "NORMAL", "FAST", "ULTRA", "PAUSED"] as SpeedType[]
    ).entries()) {
      const beforeTimeouts = timeout.mock.calls.length;
      await send({
        kind: "command",
        sender: "host",
        envelope: {
          matchId: "match",
          epoch: "epoch",
          sequence: sequence + 1,
          command: { kind: "speed", speed },
        },
      });
      expect(timeout.mock.calls.slice(beforeTimeouts)).toContainEqual([
        expect.any(Function),
        TICK_MS[speed],
      ]);
      const before = ticks;
      // Fractional frame intervals are floored by browser timers.
      jest.advanceTimersByTime(Math.floor(TICK_MS[speed]));
      expect(ticks).toBe(before + (speed === "PAUSED" ? 0 : 1));
    }
    await send({
      kind: "command",
      sender: "host",
      envelope: {
        matchId: "match",
        epoch: "epoch",
        sequence: 6,
        command: { kind: "speed", speed: "NORMAL" },
      },
    });
    await send({
      kind: "checkpoint",
      requestId: "sleep",
      pause: true,
      suspended: true,
    });
    expect(world.paused).toBe(true);
    expect(world.reason).toMatch(/sleep/);
    const beforeSleep = ticks;
    jest.advanceTimersByTime(1000);
    expect(ticks).toBe(beforeSleep);
    expect(post).toHaveBeenCalledWith({
      kind: "checkpoint",
      world,
      requestId: "sleep",
    });
  } finally {
    jest.clearAllTimers();
    timeout.mockRestore();
    post.mockRestore();
    scope.onmessage = previousMessage;
    globalThis.fetch = previousFetch;
    jest.useRealTimers();
  }
});

test("idle paused couch workers send small pulses, suppress unchanged views, and force checkpoint projections", async () => {
  jest.useFakeTimers();
  const scope = globalThis as unknown as Worker;
  const previousMessage = scope.onmessage;
  const previousFetch = globalThis.fetch;
  const post = jest.spyOn(scope, "postMessage").mockImplementation(() => {});
  const { createWorld, roomView, applyCommand } = jest.requireMock(
    "../multiplayer/World",
  );
  createWorld.mockReturnValue({
    matchId: "match",
    epoch: "epoch",
    revision: 0,
    speed: "PAUSED",
    paused: true,
    grids: [{ date: { minute: 0 } }],
    outcomes: {},
    ready: [],
    selectedSpeeds: {},
    activities: {},
    seats: [{ id: "host" }, { id: "guest" }],
  });
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(0),
  });
  try {
    require("./Multiplayer.worker");
    const send = async (data: WorkerRequest) =>
      scope.onmessage!({ data } as MessageEvent<WorkerRequest>);
    await send({
      kind: "create",
      local: true,
      spec: { scenarioId: 101, difficulty: "Employee" },
      seats: [{ id: "host", name: "Host" }],
      matchId: "match",
      epoch: "epoch",
    });
    expect(roomView).toHaveBeenCalledTimes(2);
    await send({ kind: "views-applied" });
    jest.advanceTimersByTime(11000);
    expect(roomView).toHaveBeenCalledTimes(2);
    expect(
      post.mock.calls.filter(([event]) => event.kind === "views"),
    ).toHaveLength(1);
    expect(
      post.mock.calls.filter(([event]) => event.kind === "keepalive"),
    ).toHaveLength(11);
    expect(post).toHaveBeenCalledWith({
      kind: "keepalive",
      matchId: "match",
      epoch: "epoch",
      revision: 0,
    });
    // Full saves retain their cadence; an explicit checkpoint forces a complete local projection.
    expect(
      post.mock.calls.filter(([event]) => event.kind === "checkpoint"),
    ).toHaveLength(2);
    await send({ kind: "checkpoint" });
    expect(roomView).toHaveBeenCalledTimes(4);
    await send({ kind: "views-applied" });
    applyCommand.mockImplementation((target: World) => {
      target.revision++;
    });
    for (const sequence of [1, 2])
      await send({
        kind: "command",
        sender: "host",
        envelope: {
          matchId: "match",
          epoch: "epoch",
          sequence,
          command: { kind: "rate", value: 0.2 },
        },
      });
    expect(roomView).toHaveBeenCalledTimes(4);
    jest.advanceTimersByTime(99);
    expect(roomView).toHaveBeenCalledTimes(4);
    jest.advanceTimersByTime(1);
    expect(roomView).toHaveBeenCalledTimes(6);
    expect(
      post.mock.calls.filter(([event]) => event.kind === "views").at(-1)?.[0],
    ).toEqual({
      kind: "views",
      views: {
        host: { receipt: { sequence: 2, error: undefined } },
        guest: {},
      },
    });
  } finally {
    jest.clearAllTimers();
    post.mockRestore();
    scope.onmessage = previousMessage;
    globalThis.fetch = previousFetch;
    jest.useRealTimers();
  }
});

test("a fresh worker loads the saved match's location before validating and restoring its world", async () => {
  jest.useFakeTimers();
  const scope = globalThis as unknown as Worker;
  const previousMessage = scope.onmessage;
  const previousFetch = globalThis.fetch;
  const post = jest.spyOn(scope, "postMessage").mockImplementation(() => {});
  const { restoreWorld } = jest.requireMock("../multiplayer/World");
  const { initWeather } = jest.requireMock("../data/Weather");
  const { matchScenario } = jest.requireMock("../multiplayer/World");
  const spec = { scenarioId: 101, difficulty: "Employee" as const };
  const saved = {
    schema: 3,
    gameSchema: SAVE_SCHEMA_VERSION,
    rules: manifest.multiplayerCompatibilityId,
    speed: "PAUSED",
    paused: true,
    spec,
    grids: [{ date: { minute: 0 } }],
    outcomes: {},
    ready: [],
    selectedSpeeds: {},
    activities: {},
    seats: [
      { id: "host", name: "Host" },
      { id: "guest", name: "Guest" },
    ],
  } as unknown as World;
  // The players resuming it, who claimed the saved companies.
  const seats = [
    { id: "host", name: "Host" },
    { id: "friend", name: "Friend" },
  ];
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(0),
  });
  restoreWorld.mockImplementation((world: World) => {
    expect(matchScenario).toHaveBeenCalledWith(spec);
    expect(initWeather).toHaveBeenCalledWith(
      { id: "SF" },
      expect.any(Function),
    );
    return world;
  });
  try {
    require("./Multiplayer.worker");
    await scope.onmessage!({
      data: {
        kind: "restore",
        local: true,
        world: saved,
        epoch: "restored",
        seats,
      },
    } as MessageEvent<WorkerRequest>);
    expect(restoreWorld).toHaveBeenCalledWith(saved, "restored", seats);
    expect(post).toHaveBeenCalledWith({ kind: "checkpoint", world: saved });
  } finally {
    jest.clearAllTimers();
    post.mockRestore();
    scope.onmessage = previousMessage;
    globalThis.fetch = previousFetch;
    jest.useRealTimers();
  }
});

test.each([
  { schema: 99, gameSchema: SAVE_SCHEMA_VERSION },
  { schema: 3, gameSchema: SAVE_SCHEMA_VERSION + 1 },
])(
  "a future shared envelope %j is rejected before loading its scenario data",
  async (version) => {
    jest.useFakeTimers();
    const scope = globalThis as unknown as Worker;
    const previousMessage = scope.onmessage;
    const previousFetch = globalThis.fetch;
    const post = jest.spyOn(scope, "postMessage").mockImplementation(() => {});
    const { restoreWorld, matchScenario } = jest.requireMock(
      "../multiplayer/World",
    );
    const { initWeather } = jest.requireMock("../data/Weather");
    globalThis.fetch = jest.fn();
    const saved = {
      ...version,
      spec: { scenarioId: 101, difficulty: "Employee" },
    };
    try {
      require("./Multiplayer.worker");
      await scope.onmessage!({
        data: { kind: "restore", local: true, world: saved, epoch: "future" },
      } as MessageEvent<WorkerRequest>);
      expect(matchScenario).not.toHaveBeenCalled();
      expect(initWeather).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(restoreWorld).not.toHaveBeenCalled();
      expect(post).toHaveBeenCalledWith({
        kind: "error",
        message: expect.stringMatching(
          /unsupported format.*original save is preserved/,
        ),
      });
    } finally {
      jest.clearAllTimers();
      post.mockRestore();
      scope.onmessage = previousMessage;
      globalThis.fetch = previousFetch;
      jest.useRealTimers();
    }
  },
);

test("a command that throws mid-match stops the shared clock for everyone and refuses later commands", async () => {
  jest.useFakeTimers();
  const scope = globalThis as unknown as Worker;
  const previousMessage = scope.onmessage;
  const previousFetch = globalThis.fetch;
  const post = jest.spyOn(scope, "postMessage").mockImplementation(() => {});
  const { createWorld, applyCommand, stepWorld } = jest.requireMock(
    "../multiplayer/World",
  );
  const world = {
    matchId: "match",
    epoch: "epoch",
    revision: 0,
    speed: "NORMAL",
    paused: false,
    reason: "",
    grids: [{ date: { minute: 0 } }],
    outcomes: {},
    ready: [],
    selectedSpeeds: {},
    activities: {},
    seats: [{ id: "host" }, { id: "guest" }],
  } as unknown as World;
  createWorld.mockReturnValue(world);
  let ticks = 0;
  stepWorld.mockImplementation(() => {
    ticks++;
  });
  applyCommand.mockImplementation(() => {
    throw new Error("Reducer failed");
  });
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(0),
  });
  try {
    require("./Multiplayer.worker");
    const send = async (data: WorkerRequest) =>
      scope.onmessage!({ data } as MessageEvent<WorkerRequest>);
    const command = (sequence: number): WorkerRequest => ({
      kind: "command",
      sender: "guest",
      envelope: {
        matchId: "match",
        epoch: "epoch",
        sequence,
        command: { kind: "speed", speed: "FAST" },
      },
    });
    await send({
      kind: "create",
      local: true,
      spec: { scenarioId: 101, difficulty: "Employee" },
      seats: [{ id: "host", name: "Host" }],
      matchId: "match",
      epoch: "epoch",
    });
    post.mockClear();
    await send({ kind: "views-applied" });
    await send(command(1));
    expect(post).toHaveBeenCalledWith({
      kind: "error",
      message: "Reducer failed",
    });
    expect(world.paused).toBe(true);
    expect(world.reason).toMatch(/simulation stopped/);
    // Every player sees the stop immediately rather than a clock that silently freezes.
    expect(post.mock.calls.some(([event]) => event.kind === "views")).toBe(
      true,
    );
    const stopped = ticks;
    post.mockClear();
    jest.advanceTimersByTime(5000);
    expect(ticks).toBe(stopped);
    expect(post).not.toHaveBeenCalled();
    applyCommand.mockClear();
    await send(command(2));
    expect(applyCommand).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith({
      kind: "error",
      message: "Resume the last complete multiplayer save in a new lobby",
    });
  } finally {
    jest.clearAllTimers();
    post.mockRestore();
    scope.onmessage = previousMessage;
    globalThis.fetch = previousFetch;
    jest.useRealTimers();
  }
});

test("local shell summaries follow an active company's calendar and publish current pause causes", async () => {
  jest.useFakeTimers();
  const scope = globalThis as unknown as Worker;
  const previousMessage = scope.onmessage;
  const post = jest.spyOn(scope, "postMessage").mockImplementation(() => {});
  const { createWorld, setWorldBlockers } = jest.requireMock(
    "../multiplayer/World",
  );
  const { pendingScenarioChoice } = jest.requireMock(
    "../helpers/ScenarioChoices",
  );
  const outcomes = {
    "local-p1": { outcome: "bankrupt", title: "Bankrupt", month: 1 },
  };
  const world = {
    matchId: "local-match",
    epoch: "local-epoch",
    revision: 4,
    speed: "PAUSED",
    paused: true,
    reason: "Ready up",
    readyRequired: true,
    ready: [],
    seats: [
      { id: "local-p1", name: "Ada" },
      { id: "local-p2", name: "Grace" },
    ],
    grids: [{ date: { minute: 10 } }, { date: { minute: 100 } }],
    outcomes,
    activities: { "local-p2": "Plant notification open" },
    selectedSpeeds: { "local-p1": "PAUSED", "local-p2": "NORMAL" },
  };
  createWorld.mockReturnValue(world);
  setWorldBlockers(world, [
    "Controller disconnected",
    "TV session dialog open",
  ]);
  pendingScenarioChoice.mockReturnValue({ title: "Winterization" });
  const create = createWorld.getMockImplementation();
  createWorld.mockImplementation((...args: unknown[]) => {
    // Local simulation must install the real telemetry hooks before creating any grid.
    const { desktopSimulationHooks } =
      require("../achievements/SimulationHooks") as typeof import("../achievements/SimulationHooks");
    expect(desktopSimulationHooks()).toBeDefined();
    return create(...args);
  });
  try {
    require("./Multiplayer.worker");
    await scope.onmessage!({
      data: {
        kind: "create",
        local: true,
        spec: { scenarioId: 101, difficulty: "Employee" },
        seats: [
          { id: "local-p1", name: "Ada" },
          { id: "local-p2", name: "Grace" },
        ],
        matchId: "local-match",
        epoch: "local-epoch",
      },
    } as MessageEvent<WorkerRequest>);
    expect(post).toHaveBeenCalledWith({
      kind: "summary",
      summary: expect.objectContaining({
        date: { minute: 100 },
        outcomes,
        complete: false,
        systemBlockers: ["Controller disconnected", "TV session dialog open"],
        players: [
          expect.objectContaining({
            id: "local-p1",
            retired: true,
            pendingChoice: undefined,
          }),
          expect.objectContaining({
            id: "local-p2",
            selectedSpeed: "NORMAL",
            pauseReason: "Plant notification open",
            pendingChoice: "Winterization",
            retired: false,
          }),
        ],
      }),
    });
  } finally {
    jest.clearAllTimers();
    post.mockRestore();
    scope.onmessage = previousMessage;
    jest.useRealTimers();
  }
});

test("a slow couch shell bounds cloned views while ticks, receipts, checkpoints and safety stops continue", async () => {
  jest.useFakeTimers();
  const scope = globalThis as unknown as Worker;
  const previousMessage = scope.onmessage;
  const post = jest.spyOn(scope, "postMessage").mockImplementation(() => {});
  const { createWorld, roomView, applyCommand, stepWorld } = jest.requireMock(
    "../multiplayer/World",
  );
  const world = {
    matchId: "match",
    epoch: "epoch",
    revision: 0,
    speed: "FAST",
    paused: false,
    reason: "",
    grids: [{ date: { minute: 0 } }],
    outcomes: {},
    ready: [],
    selectedSpeeds: {},
    activities: {},
    seats: [{ id: "host" }, { id: "guest" }],
  } as unknown as World;
  createWorld.mockReturnValue(world);
  roomView.mockImplementation((value: World) => ({
    revision: value.revision,
    speed: value.speed,
    reason: value.reason,
  }));
  stepWorld.mockImplementation((value: World) => {
    if (!value.paused) value.revision++;
  });
  applyCommand.mockImplementation((value: World, sender: string) => {
    if (sender === "guest") return "Not enough cash";
    value.revision++;
    value.speed = "SLOW";
  });
  try {
    require("./Multiplayer.worker");
    const send = async (data: WorkerRequest) =>
      scope.onmessage!({ data } as MessageEvent<WorkerRequest>);
    await send({
      kind: "create",
      local: true,
      spec: { scenarioId: 101, difficulty: "Employee" },
      seats: [
        { id: "host", name: "Host" },
        { id: "guest", name: "Guest" },
      ],
      matchId: "match",
      epoch: "epoch",
    });
    // Leave the first bundle outstanding while the real worker scheduler keeps ticking.
    jest.advanceTimersByTime(1000);
    expect(world.revision).toBeGreaterThan(1);
    expect(roomView).toHaveBeenCalledTimes(2);
    expect(
      post.mock.calls.filter(([event]) => event.kind === "views"),
    ).toHaveLength(1);
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "keepalive" }),
    );
    await send({ kind: "heartbeat" });
    for (const sender of ["host", "guest"])
      await send({
        kind: "command",
        sender,
        envelope: {
          matchId: "match",
          epoch: "epoch",
          sequence: 1,
          command: { kind: "speed", speed: "SLOW" },
        },
      });
    await send({ kind: "disconnect", sender: "guest" });
    await send({ kind: "checkpoint", requestId: "save" });
    expect(post).toHaveBeenCalledWith({
      kind: "checkpoint",
      world,
      requestId: "save",
    });
    expect(roomView).toHaveBeenCalledTimes(2);
    await send({ kind: "views-applied" });
    expect(roomView).toHaveBeenCalledTimes(4);
    expect(
      post.mock.calls.filter(([event]) => event.kind === "views").at(-1)?.[0],
    ).toEqual({
      kind: "views",
      views: {
        host: {
          revision: world.revision,
          speed: "PAUSED",
          reason: "A player disconnected. Reconnect before resuming.",
          receipt: { sequence: 1, error: undefined },
        },
        guest: {
          revision: world.revision,
          speed: "PAUSED",
          reason: "A player disconnected. Reconnect before resuming.",
          receipt: { sequence: 1, error: "Not enough cash" },
        },
      },
    });
    // The fault path stops timers, but consuming its predecessor must still publish the stop.
    applyCommand.mockImplementation(() => {
      throw new Error("Reducer failed");
    });
    await send({
      kind: "command",
      sender: "host",
      envelope: {
        matchId: "match",
        epoch: "epoch",
        sequence: 2,
        command: { kind: "speed", speed: "FAST" },
      },
    });
    expect(roomView).toHaveBeenCalledTimes(4);
    await send({ kind: "views-applied" });
    expect(
      post.mock.calls.filter(([event]) => event.kind === "views").at(-1)?.[0],
    ).toEqual({
      kind: "views",
      views: {
        host: expect.objectContaining({
          speed: "PAUSED",
          reason: expect.stringMatching(/simulation stopped/),
        }),
        guest: expect.objectContaining({
          speed: "PAUSED",
          reason: expect.stringMatching(/simulation stopped/),
        }),
      },
    });
    await send({ kind: "views-applied" });
    await send({ kind: "views-applied" });
    expect(roomView).toHaveBeenCalledTimes(6);
  } finally {
    jest.clearAllTimers();
    post.mockRestore();
    scope.onmessage = previousMessage;
    jest.useRealTimers();
  }
});

test("online play projects only the host seat, orders baselines and coalesces command records", async () => {
  jest.useFakeTimers();
  const scope = globalThis as unknown as Worker;
  const previousMessage = scope.onmessage;
  const post = jest.spyOn(scope, "postMessage").mockImplementation(() => {});
  Object.assign(globalThis, { TextEncoder });
  const { createWorld, roomView, applyCommand } = jest.requireMock(
    "../multiplayer/World",
  );
  const world = {
    matchId: "match",
    epoch: "epoch",
    revision: 0,
    speed: "PAUSED",
    paused: true,
    readyRequired: true,
    ready: [],
    reason: "Paused",
    outcomes: {},
    sequences: {},
    receipts: {},
    seats: [
      { id: "host", name: "Host" },
      { id: "guest", name: "Guest" },
    ],
  } as unknown as World;
  createWorld.mockReturnValue(world);
  applyCommand.mockImplementation(
    (target: World, sender: string, envelope: { sequence: number }) => {
      if (envelope.sequence !== (target.sequences[sender] || 0) + 1)
        return "A command is missing";
      target.sequences[sender] = envelope.sequence;
      target.revision++;
    },
  );
  try {
    require("./Multiplayer.worker");
    const send = async (data: WorkerRequest) =>
      scope.onmessage!({ data } as MessageEvent<WorkerRequest>);
    await send({
      kind: "create",
      spec: { scenarioId: 101, difficulty: "Employee" },
      seats: world.seats,
      matchId: "match",
      epoch: "epoch",
      hostSeat: "host",
    });
    expect(roomView.mock.calls.map((call: [World, string]) => call[1])).toEqual(
      ["host"],
    );
    const first = post.mock.calls.map(([event]) => event);
    const baselineIndex = first.findIndex((event) => event.kind === "baseline");
    expect(first[baselineIndex - 1]).toMatchObject({
      kind: "records",
      from: 1,
      records: [{ t: "pause", reason: "Synchronizing Guest" }],
    });
    expect(first[baselineIndex]).toMatchObject({
      kind: "baseline",
      to: "guest",
      baseline: { index: 1, epoch: "epoch" },
    });
    jest.advanceTimersByTime(0);
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: "records",
        from: 2,
        records: [{ t: "verify" }],
      }),
    );
    post.mockClear();
    for (const sequence of [1, 2])
      await send({
        kind: "command",
        sender: "guest",
        envelope: {
          matchId: "match",
          epoch: "epoch",
          sequence,
          command: { kind: "rate", value: 0.2 },
        },
      });
    expect(
      post.mock.calls.filter(([event]) => event.kind === "records"),
    ).toHaveLength(0);
    jest.advanceTimersByTime(0);
    expect(
      post.mock.calls.filter(([event]) => event.kind === "records"),
    ).toHaveLength(1);
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: "records",
        from: 3,
        records: [
          expect.objectContaining({ t: "command", revision: 1 }),
          expect.objectContaining({ t: "command", revision: 2 }),
        ],
      }),
    );
    await send({
      kind: "command",
      sender: "guest",
      envelope: {
        matchId: "match",
        epoch: "epoch",
        sequence: 4,
        command: { kind: "ready" },
      },
    });
    expect(post).toHaveBeenLastCalledWith({
      kind: "rejected",
      to: "guest",
      matchId: "match",
      epoch: "epoch",
      sequence: 4,
      error: "A command is missing",
    });
  } finally {
    jest.clearAllTimers();
    post.mockRestore();
    scope.onmessage = previousMessage;
    jest.useRealTimers();
  }
});

test("replication splits batches by record count and tagged UTF-8 wire bytes without index gaps", async () => {
  jest.useFakeTimers();
  const scope = globalThis as unknown as Worker;
  const previousMessage = scope.onmessage;
  const post = jest.spyOn(scope, "postMessage").mockImplementation(() => {});
  Object.assign(globalThis, { TextEncoder });
  const { stringify } = require("../../electron/coop-codec.cjs");
  const { createWorld, applyCommand } = jest.requireMock(
    "../multiplayer/World",
  );
  const world = {
    matchId: "match",
    epoch: "epoch",
    revision: 0,
    speed: "PAUSED",
    paused: true,
    readyRequired: true,
    ready: [],
    reason: "Paused",
    outcomes: {},
    sequences: {},
    receipts: {},
    seats: [
      { id: "host", name: "Host" },
      { id: "guest", name: "Guest" },
    ],
  } as unknown as World;
  createWorld.mockReturnValue(world);
  applyCommand.mockImplementation(
    (target: World, sender: string, envelope: { sequence: number }) => {
      target.sequences[sender] = envelope.sequence;
      target.revision++;
    },
  );
  try {
    require("./Multiplayer.worker");
    const send = async (data: WorkerRequest) =>
      scope.onmessage!({ data } as MessageEvent<WorkerRequest>);
    await send({
      kind: "create",
      spec: { scenarioId: 101, difficulty: "Employee" },
      seats: world.seats,
      matchId: "match",
      epoch: "epoch",
      hostSeat: "host",
    });
    jest.advanceTimersByTime(0);
    post.mockClear();
    for (let sequence = 1; sequence <= 300; sequence++)
      await send({
        kind: "command",
        sender: "host",
        envelope: {
          matchId: "match",
          epoch: "epoch",
          sequence,
          command: { kind: "rate", value: 0.2 },
        },
      });
    jest.advanceTimersByTime(0);
    let batches = post.mock.calls
      .map(([event]) => event)
      .filter((event) => event.kind === "records");
    expect(batches.map((batch) => batch.records.length)).toEqual([256, 44]);
    expect(batches.map((batch) => batch.from)).toEqual([3, 259]);
    post.mockClear();
    for (let sequence = 301; sequence <= 330; sequence++)
      await send({
        kind: "command",
        sender: "host",
        envelope: {
          matchId: "match",
          epoch: "epoch",
          sequence,
          command: {
            kind: "action",
            name: "invalid",
            payload: { text: "λ".repeat(1000), values: Array(50).fill(-0) },
          },
        },
      });
    jest.advanceTimersByTime(0);
    batches = post.mock.calls
      .map(([event]) => event)
      .filter((event) => event.kind === "records");
    expect(batches.length).toBeGreaterThan(1);
    let next = 303;
    for (const batch of batches) {
      expect(batch.from).toBe(next);
      next += batch.records.length;
      expect(batch.records.length).toBeLessThanOrEqual(256);
      expect(Buffer.byteLength(stringify(batch))).toBeLessThanOrEqual(65536);
    }
    expect(next).toBe(333);
  } finally {
    jest.clearAllTimers();
    post.mockRestore();
    scope.onmessage = previousMessage;
    jest.useRealTimers();
  }
});

test("the worker verifies changed records, routes authenticated recovery reports and retains a permanent failure blocker", async () => {
  jest.useFakeTimers();
  const scope = globalThis as unknown as Worker;
  const previousMessage = scope.onmessage;
  const post = jest.spyOn(scope, "postMessage").mockImplementation(() => {});
  const hash = jest
    .spyOn(webcrypto.subtle, "digest")
    .mockResolvedValue(new Uint8Array(32).fill(1).buffer);
  const { createWorld, applyCommand, worldBlockers } = jest.requireMock(
    "../multiplayer/World",
  );
  const world = {
    matchId: "match",
    epoch: "epoch",
    revision: 0,
    speed: "PAUSED",
    paused: true,
    readyRequired: true,
    ready: [],
    reason: "Paused",
    outcomes: {},
    sequences: {},
    receipts: {},
    seats: [
      { id: "host", name: "Host" },
      { id: "guest", name: "Guest" },
    ],
  } as unknown as World;
  createWorld.mockReturnValue(world);
  applyCommand.mockImplementation(
    (target: World, sender: string, envelope: { sequence: number }) => {
      target.sequences[sender] = envelope.sequence;
      target.revision++;
    },
  );
  try {
    require("./Multiplayer.worker");
    const send = async (data: WorkerRequest) =>
      scope.onmessage!({ data } as MessageEvent<WorkerRequest>);
    const events = () => post.mock.calls.map(([event]) => event);
    const baselines = () =>
      events().filter((event) => event.kind === "baseline");
    const records = () =>
      events()
        .filter((event) => event.kind === "records")
        .flatMap((event) => event.records);
    await send({
      kind: "create",
      spec: { scenarioId: 101, difficulty: "Employee" },
      seats: world.seats,
      matchId: "match",
      epoch: "epoch",
      hostSeat: "host",
    });
    await send({ kind: "replica-peers", connected: ["guest"] });
    await send({
      kind: "progress",
      sender: "guest",
      matchId: "match",
      epoch: "epoch",
      applied: 2,
      verified: { index: 2, hash: "01".repeat(32) },
    });
    await send({
      kind: "command",
      sender: "host",
      envelope: {
        matchId: "match",
        epoch: "epoch",
        sequence: 1,
        command: { kind: "rate", value: 0.15 },
      },
    });
    jest.advanceTimersByTime(999);
    expect(records().filter((record) => record.t === "verify")).toHaveLength(1);
    jest.advanceTimersByTime(2);
    expect(records().filter((record) => record.t === "verify")).toHaveLength(2);
    jest.advanceTimersByTime(1000);
    expect(records().filter((record) => record.t === "verify")).toHaveLength(2);
    await send({
      kind: "resync",
      sender: "guest",
      matchId: "match",
      epoch: "old",
      applied: 2,
      reason: "old",
    });
    expect(baselines()).toHaveLength(1);
    await send({
      kind: "progress",
      sender: "guest",
      matchId: "match",
      epoch: "epoch",
      applied: 4,
      verified: { index: 4, hash: "00".repeat(32) },
    });
    expect(baselines()).toHaveLength(2);
    await send({
      kind: "resync",
      sender: "guest",
      matchId: "match",
      epoch: "epoch",
      applied: 4,
      reason: "retry",
    });
    expect(baselines()).toHaveLength(2);
    // The acknowledged opening baseline is not a failure. The divergent report
    // starts one recovery transfer; two unanswered transfers then stop recovery.
    jest.advanceTimersByTime(10100);
    expect(baselines()).toHaveLength(3);
    jest.advanceTimersByTime(10100);
    expect(baselines()).toHaveLength(3);
    const failure = "Guest could not stay in sync. Save and resume the match.";
    expect(world.reason).toBe(failure);
    await send({ kind: "blockers", reasons: ["System dialog"] });
    expect(worldBlockers(world)).toEqual(["System dialog", failure]);
    await send({ kind: "blockers", reasons: [] });
    expect(worldBlockers(world)).toEqual([failure]);
    expect(records()).toContainEqual({ t: "pause", reason: failure });
  } finally {
    jest.clearAllTimers();
    hash.mockRestore();
    post.mockRestore();
    scope.onmessage = previousMessage;
    jest.useRealTimers();
  }
});
