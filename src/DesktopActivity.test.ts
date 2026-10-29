import { desktopActivity, startDesktopActivity } from "./DesktopActivity";
import type { DesktopBridge, DesktopState } from "./Desktop";
import type { RootState } from "./Store";
import type { GameEventType, VictoryType } from "./Types";
import { CUSTOM_SCENARIO_ID, SCENARIOS } from "./data/Scenarios";

function fixture() {
  let current = {
    game: {
      inGame: true,
      scenarioId: 101,
      speed: "NORMAL",
      date: { minute: 0, monthsElapsed: 0 },
      eventLog: [],
    },
    settings: { steamTimelineEnabled: true },
    card: { name: "FACILITIES" },
    saves: { activeId: "run-a" },
    ui: { evidenceRunId: 1, victory: null },
  } as unknown as RootState;
  const listeners = new Set<() => void>();
  let steamChanged: (state: DesktopState) => void = () => {};
  const setActivity = jest.fn().mockResolvedValue(undefined);
  const addTimelineEvent = jest.fn().mockResolvedValue(undefined);
  const unsubscribeSteam = jest.fn();
  const desktop = {
    setActivity,
    addTimelineEvent,
    onStateChanged: (listener: typeof steamChanged) => {
      steamChanged = listener;
      return unsubscribeSteam;
    },
  } as unknown as DesktopBridge;
  const store = {
    getState: () => current,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    store,
    desktop,
    setActivity,
    addTimelineEvent,
    unsubscribeSteam,
    steamChanged: (state: DesktopState) => steamChanged(state),
    update: (transform: (state: RootState) => RootState) => {
      current = transform(current);
      listeners.forEach((listener) => listener());
    },
  };
}
const event = (id: number, kind: GameEventType["kind"]): GameEventType => ({
  id,
  kind,
  label: "Jan 2020",
  message: "Private facility or save name",
});
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};

it("publishes bounded progress and phases without private custom or victory names", () => {
  const { store } = fixture();
  const initial = store.getState();
  const totalYears = Math.ceil(
    SCENARIOS.find(({ id }) => id === 101)!.durationMonths / 12,
  );
  expect(desktopActivity(initial)).toEqual({
    phase: "playing",
    scenarioId: 101,
    year: 1,
    totalYears,
    timelineEnabled: true,
  });
  const custom = {
    ...initial,
    game: {
      ...initial.game,
      scenarioId: CUSTOM_SCENARIO_ID,
      customScenario: { name: "Private Company" },
      date: { minute: 500, monthsElapsed: 99999 },
    },
  } as RootState;
  expect(desktopActivity(custom)).toEqual({
    phase: "playing",
    scenarioId: CUSTOM_SCENARIO_ID,
    year: 1,
    totalYears: 1,
    timelineEnabled: true,
  });
  expect(JSON.stringify(desktopActivity(custom))).not.toContain("Private");
  const longCustom = {
    ...custom,
    game: {
      ...custom.game,
      customScenario: { ...custom.game.customScenario, durationMonths: 240 },
      date: { minute: 500, monthsElapsed: 84 },
    },
  } as RootState;
  expect(desktopActivity(longCustom)).toEqual({
    phase: "playing",
    scenarioId: CUSTOM_SCENARIO_ID,
    year: 8,
    totalYears: 20,
    timelineEnabled: true,
  });
  expect(JSON.stringify(desktopActivity(longCustom))).not.toContain("Private");
  expect(
    desktopActivity({ ...initial, card: { ...initial.card, name: "LOADING" } })
      .phase,
  ).toBe("loading");
  expect(
    desktopActivity({ ...initial, card: { ...initial.card, name: "SETTINGS" } })
      .phase,
  ).toBe("paused");
  expect(
    desktopActivity({ ...initial, game: { ...initial.game, inGame: false } })
      .phase,
  ).toBe("menu");
});

it("updates presence only on meaningful changes, retries on connection changes, and disposes", async () => {
  const f = fixture();
  const stop = startDesktopActivity(f.store, f.desktop);
  await flush();
  expect(f.setActivity).toHaveBeenCalledTimes(1);
  f.update((state) => ({
    ...state,
    game: {
      ...state.game,
      date: { ...state.game.date, minute: 15, monthsElapsed: 1 },
    },
  }));
  await flush();
  expect(f.setActivity).toHaveBeenCalledTimes(1);
  f.update((state) => ({
    ...state,
    game: { ...state.game, date: { ...state.game.date, monthsElapsed: 12 } },
  }));
  await flush();
  expect(f.setActivity).toHaveBeenLastCalledWith(
    expect.objectContaining({ year: 2 }),
  );
  const state = {
    steam: {
      available: true,
      online: true,
      timelineSupported: true,
      cloudEnabled: false,
    },
  } as DesktopState;
  f.steamChanged(state);
  f.steamChanged(state);
  await flush();
  expect(f.setActivity).toHaveBeenCalledTimes(3);
  stop();
  f.update((state) => ({ ...state, game: { ...state.game, speed: "PAUSED" } }));
  await flush();
  expect(f.setActivity).toHaveBeenCalledTimes(3);
  expect(f.unsubscribeSteam).toHaveBeenCalledTimes(1);
});

it("records each newly committed highlight once and sends no raw event text", async () => {
  const f = fixture();
  f.update((state) => ({
    ...state,
    game: { ...state.game, eventLog: [event(1, "BLACKOUT")] },
  }));
  const stop = startDesktopActivity(f.store, f.desktop);
  f.update((state) => ({
    ...state,
    game: {
      ...state.game,
      date: { ...state.game.date, minute: 15 },
      eventLog: [
        event(5, "WORLD_EVENT"),
        event(4, "BLACKOUT_OVER"),
        event(3, "BLACKOUT"),
        event(2, "CONSTRUCTION"),
        ...state.game.eventLog,
      ],
    },
  }));
  await flush();
  expect(
    f.addTimelineEvent.mock.calls.map(([request]) => request.kind),
  ).toEqual(["construction", "blackout", "recovery"]);
  expect(JSON.stringify(f.addTimelineEvent.mock.calls)).not.toContain(
    "Private",
  );
  f.update((state) => ({ ...state, ui: { ...state.ui } }));
  await flush();
  expect(f.addTimelineEvent).toHaveBeenCalledTimes(3);
  stop();
});

it("baselines saved/restored history and preference enabling, including rewinding the same save", async () => {
  const f = fixture();
  const stop = startDesktopActivity(f.store, f.desktop);
  f.update((state) => ({
    ...state,
    settings: { ...state.settings, steamTimelineEnabled: false },
    game: { ...state.game, eventLog: [event(5, "CONSTRUCTION")] },
  }));
  f.update((state) => ({
    ...state,
    settings: { ...state.settings, steamTimelineEnabled: true },
  }));
  f.update((state) => ({
    ...state,
    ui: { ...state.ui, evidenceRunId: 2 },
    game: {
      ...state.game,
      date: { ...state.game.date, minute: 150 },
      eventLog: [event(10, "BLACKOUT")],
    },
  }));
  f.update((state) => ({
    ...state,
    game: {
      ...state.game,
      date: { ...state.game.date, minute: 15 },
      eventLog: [event(1, "BLACKOUT")],
    },
  }));
  f.update((state) => ({
    ...state,
    game: {
      ...state.game,
      date: { ...state.game.date, minute: 160 },
      eventLog: [event(10, "BLACKOUT")],
    },
  }));
  await flush();
  expect(f.addTimelineEvent).toHaveBeenCalledTimes(1);
  f.update((state) => ({
    ...state,
    game: {
      ...state.game,
      eventLog: [event(11, "BLACKOUT_OVER"), ...state.game.eventLog],
    },
  }));
  await flush();
  expect(f.addTimelineEvent).toHaveBeenCalledTimes(2);
  stop();
});

it("ignores restored victories and failures but records a completed run once", async () => {
  const f = fixture();
  const stop = startDesktopActivity(f.store, f.desktop);
  const victory = {
    scenarioId: 101,
    scenarioName: "Private save name",
    outcome: "completed",
  } as VictoryType;
  f.update((state) => ({
    ...state,
    saves: { ...state.saves, activeId: "restored" },
    ui: { ...state.ui, evidenceRunId: 1, victory },
  }));
  await flush();
  expect(f.addTimelineEvent).not.toHaveBeenCalled();
  f.update((state) => ({
    ...state,
    saves: { ...state.saves, activeId: "run-b" },
    ui: { ...state.ui, evidenceRunId: 2, victory: null },
  }));
  f.update((state) => ({
    ...state,
    ui: { ...state.ui, victory: { ...victory, outcome: "bankrupt" } },
  }));
  await flush();
  expect(f.addTimelineEvent).not.toHaveBeenCalled();
  f.update((state) => ({
    ...state,
    game: { ...state.game, inGame: false },
    ui: { ...state.ui, victory },
  }));
  f.update((state) => ({
    ...state,
    ui: { ...state.ui, victory: { ...victory, score: 123 } },
  }));
  await flush();
  expect(f.addTimelineEvent).toHaveBeenCalledTimes(1);
  expect(f.addTimelineEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "victory",
      runId: expect.stringMatching(/^run-b:/),
    }),
  );
  stop();
});

it("keeps play and later activity updates working when optional native services reject", async () => {
  const f = fixture();
  f.setActivity.mockRejectedValueOnce(new Error("Steam offline"));
  f.addTimelineEvent.mockRejectedValue(new Error("Unsupported Timeline"));
  const stop = startDesktopActivity(f.store, f.desktop);
  f.update((state) => ({
    ...state,
    game: {
      ...state.game,
      speed: "PAUSED",
      eventLog: [event(1, "CONSTRUCTION")],
    },
  }));
  await flush();
  expect(f.setActivity).toHaveBeenLastCalledWith(
    expect.objectContaining({ phase: "paused" }),
  );
  expect(f.addTimelineEvent).toHaveBeenCalledTimes(1);
  stop();
});

it("drops queued highlights when a delayed native call outlives its play segment", async () => {
  const f = fixture();
  let release!: () => void;
  f.setActivity.mockReturnValueOnce(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  const stop = startDesktopActivity(f.store, f.desktop);
  await flush();
  f.update((state) => ({
    ...state,
    game: { ...state.game, eventLog: [event(1, "BLACKOUT")] },
  }));
  f.update((state) => ({
    ...state,
    ui: { ...state.ui, evidenceRunId: 2 },
    saves: { ...state.saves, transitioning: true },
  }));
  release();
  await flush();
  expect(f.addTimelineEvent).not.toHaveBeenCalled();
  expect(f.setActivity).toHaveBeenLastCalledWith(
    expect.objectContaining({ phase: "loading" }),
  );
  stop();
});
