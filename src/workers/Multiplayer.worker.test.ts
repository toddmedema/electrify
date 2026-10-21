import { TICK_MS } from "../Constants";
import type { SpeedType } from "../Types";
import type { World } from "../multiplayer/Types";
import type { WorkerRequest } from "../multiplayer/WorkerProtocol";
import { SAVE_SCHEMA_VERSION } from "../SaveUpgrade";

jest.mock("../data/Economy", () => ({
  initEconomy: (done: () => void) => done(),
}));
jest.mock("../data/FuelPrices", () => ({
  initFuelPrices: (done: () => void) => done(),
}));
jest.mock("../data/Weather", () => ({
  initWeather: jest.fn((_location: unknown, done: () => void) => done()),
}));
jest.mock("../multiplayer/World", () => ({
  createWorld: jest.fn(),
  matchScenario: jest.fn(() => ({ location: { id: "SF" } })),
  restoreWorld: jest.fn(),
  savedMatchSpec: jest.requireActual("../multiplayer/World").savedMatchSpec,
  applyCommand: jest.fn(),
  stepWorld: jest.fn(),
  roomView: jest.fn(() => ({})),
  checkpointWorld: (world: World) => world,
  pauseWorld: (world: World, reason: string) => {
    world.speed = "PAUSED";
    world.paused = true;
    world.reason = reason;
  },
}));

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
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
      spec: { scenarioId: 101, difficulty: "Employee" },
      seats: [{ id: "host", name: "Host" }],
      matchId: "match",
      epoch: "epoch",
    });
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
  } finally {
    jest.clearAllTimers();
    timeout.mockRestore();
    post.mockRestore();
    scope.onmessage = previousMessage;
    globalThis.fetch = previousFetch;
    jest.useRealTimers();
  }
});

test("idle paused workers send small host pulses, suppress unchanged views, and force reconnect baselines", async () => {
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
      spec: { scenarioId: 101, difficulty: "Employee" },
      seats: [{ id: "host", name: "Host" }],
      matchId: "match",
      epoch: "epoch",
    });
    expect(roomView).toHaveBeenCalledTimes(2);
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
    // Full saves retain their existing cadence; reconnect gets a complete view immediately.
    expect(
      post.mock.calls.filter(([event]) => event.kind === "checkpoint"),
    ).toHaveLength(2);
    await send({ kind: "checkpoint" });
    expect(roomView).toHaveBeenCalledTimes(4);
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
    expect(post).toHaveBeenLastCalledWith({
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
    speed: "PAUSED",
    paused: true,
    spec,
    seats: [
      { id: "host", name: "Host" },
      { id: "guest", name: "Guest" },
    ],
  } as unknown as World;
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
      data: { kind: "restore", world: saved, epoch: "restored" },
    } as MessageEvent<WorkerRequest>);
    expect(restoreWorld).toHaveBeenCalledWith(saved, "restored");
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
        data: { kind: "restore", world: saved, epoch: "future" },
      } as MessageEvent<WorkerRequest>);
      expect(matchScenario).not.toHaveBeenCalled();
      expect(initWeather).not.toHaveBeenCalled();
      expect(globalThis.fetch).not.toHaveBeenCalled();
      expect(restoreWorld).not.toHaveBeenCalled();
      expect(post).toHaveBeenCalledWith({
        kind: "error",
        message: expect.stringMatching(
          /newer game.*original save is preserved/,
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
      spec: { scenarioId: 101, difficulty: "Employee" },
      seats: [{ id: "host", name: "Host" }],
      matchId: "match",
      epoch: "epoch",
    });
    post.mockClear();
    await send(command(1));
    expect(post).toHaveBeenCalledWith({
      kind: "error",
      message: "Reducer failed",
    });
    expect(world.paused).toBe(true);
    expect(world.reason).toMatch(/simulation stopped/);
    // Every player sees the stop immediately rather than a clock that silently freezes.
    expect(post.mock.calls.at(-1)?.[0].kind).toBe("views");
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
      message: "Resume the last complete shared save in a new lobby",
    });
  } finally {
    jest.clearAllTimers();
    post.mockRestore();
    scope.onmessage = previousMessage;
    globalThis.fetch = previousFetch;
    jest.useRealTimers();
  }
});
