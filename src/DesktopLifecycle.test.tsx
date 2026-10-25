import { act, render, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import App from "./App";
import { DesktopBridge, DesktopPowerState } from "./Desktop";
import { store } from "./Store";
import { delta as gameDelta } from "./reducers/Game";
import { change } from "./reducers/Settings";
import { pause, resume } from "./data/Audio";
import { quit } from "./reducers/GameActions";
import {
  delta as userDelta,
  reset,
  restoreCompetitiveBests,
} from "./reducers/User";
import { competitiveBest } from "./helpers/Scoring";
import { savedRunResult } from "./SaveModel";
import { fakeSaveFile, fakeSavedResult } from "./testing/SaveTestHelpers";
import { saveRepository } from "./SaveSession";

jest.mock("./components/CompositorContainer", () => () => null);
jest.mock("./components/base/CloudSavePrompt", () => () => null);
jest.mock("./components/base/SharedGameDialog", () => () => null);
jest.mock("./components/base/ScenarioChoiceDialog", () => () => null);
jest.mock("./CloudSaves", () => ({ startCloudSaves: () => () => {} }));
jest.mock("./SaveSession", () => ({
  saveRepository: { list: jest.fn(), read: jest.fn() },
  startSaveSessions: () => () => {},
  saveSessionMiddleware: () => (next: (action: unknown) => unknown) => next,
}));
jest.mock("./EventToasts", () => ({ startEventToasts: () => () => {} }));
jest.mock("./data/Audio", () => ({
  ...jest.requireActual("./data/Audio"),
  pause: jest.fn(),
  resume: jest.fn(),
}));
jest.mock("./Globals", () => ({
  ...jest.requireActual("./Globals"),
  firebaseAppAuth: undefined,
}));
jest.mock("firebase/auth", () => ({
  ...jest.requireActual("firebase/auth"),
  getAuth: jest.fn(),
}));

it("restores only current completed official bests after a Steam restart and keeps newer scores", async () => {
  const previousDesktop = process.env.REACT_APP_DESKTOP;
  process.env.REACT_APP_DESKTOP = "true";
  const result = (patch: Parameters<typeof fakeSavedResult>[0] = {}) =>
    savedRunResult({
      ...fakeSavedResult({
        scoreVersion: 2,
        breakdown: { service: 80, financial: 20, environmental: -5 },
        ...patch,
      }),
      ranked: true,
    });
  const results = [
    result({ score: 800 }),
    result({ score: 600 }),
    result({ score: 9000, outcome: "bankrupt" }),
    result({ score: 9001, outcome: "fired" }),
    result({ score: 9999, scoreVersion: undefined }),
    result({ score: 10000, scoreVersion: 1 }),
    result({ score: 10001, scenarioId: 999 }),
    result({ score: 10002, scenarioId: 0 }),
  ];
  (saveRepository.list as jest.Mock).mockResolvedValue(
    results.map((record, index) => ({
      id: String(index),
      status: record.outcome,
      savedAt: "2026-10-24T00:00:00Z",
    })),
  );
  (saveRepository.read as jest.Mock).mockImplementation(async (id: string) => ({
    ...fakeSaveFile(),
    result: results[Number(id)],
  }));
  const uid = "steam:76561198000000001";
  window.electrifyDesktop = {
    apiVersion: 1,
    onGameFocusChanged: () => () => {},
    onStateChanged: () => () => {},
    onBeforeQuit: () => () => {},
    getState: jest.fn().mockResolvedValue({ steam: { steamId: uid.slice(6) } }),
    setActivity: jest.fn().mockResolvedValue(undefined),
  } as unknown as DesktopBridge;
  store.dispatch(reset());
  const view = render(
    <Provider store={store}>
      <App />
    </Provider>,
  );
  try {
    await waitFor(() =>
      expect(competitiveBest(store.getState().user.bests, 101)?.score).toBe(
        800,
      ),
    );
    expect(store.getState().user.bests?.["101"]).toBeUndefined();
    expect(competitiveBest(store.getState().user.bests, 999)).toBeUndefined();
    expect(competitiveBest(store.getState().user.bests, 0)).toBeUndefined();
    const higher = { scoreVersion: 2, score: 900, difficulty: "CEO", date: 2 };
    store.dispatch(userDelta({ bests: { "v2:101": higher } }));
    store.dispatch(
      restoreCompetitiveBests({
        uid,
        bests: { "v2:101": { ...higher, score: 800 } },
      }),
    );
    expect(competitiveBest(store.getState().user.bests, 101)?.score).toBe(900);
  } finally {
    view.unmount();
    delete window.electrifyDesktop;
    if (previousDesktop === undefined) delete process.env.REACT_APP_DESKTOP;
    else process.env.REACT_APP_DESKTOP = previousDesktop;
    store.dispatch(reset());
    (saveRepository.list as jest.Mock).mockReset();
    (saveRepository.read as jest.Mock).mockReset();
  }
});

it("keeps gameplay and audio paused through visibility/pageshow events until native focus returns", async () => {
  const focusListeners = new Set<(focused: boolean) => void>();
  const focused = (value: boolean) =>
    focusListeners.forEach((listener) => listener(value));
  const unsubscribe = jest.fn();
  window.electrifyDesktop = {
    apiVersion: 1,
    onGameFocusChanged: (listener: (focused: boolean) => void) => {
      focusListeners.add(listener);
      return () => {
        focusListeners.delete(listener);
        unsubscribe();
      };
    },
    onStateChanged: () => () => {},
    onBeforeQuit: () => () => {},
    getState: jest.fn().mockResolvedValue({ steam: {} }),
    setActivity: jest.fn().mockResolvedValue(undefined),
  } as unknown as DesktopBridge;
  store.dispatch(gameDelta({ inGame: true, speed: "NORMAL" }));
  store.dispatch(change({ audioEnabled: true }));
  const view = render(
    <Provider store={store}>
      <App />
    </Provider>,
  );
  try {
    await act(async () => focused(false));
    expect(store.getState().game.speed).toBe("PAUSED");
    expect(pause).toHaveBeenCalled();
    (resume as jest.Mock).mockClear();
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pageshow"));
    });
    expect(store.getState().game.speed).toBe("PAUSED");
    expect(resume).not.toHaveBeenCalled();
    act(() => focused(true));
    expect(store.getState().game.speed).toBe("NORMAL");
    expect(resume).toHaveBeenCalled();
  } finally {
    view.unmount();
    delete window.electrifyDesktop;
    store.dispatch(quit());
  }
  expect(unsubscribe).toHaveBeenCalled();
  expect(focusListeners.size).toBe(0);
});

it("system sleep pauses a focused game and ignores stale state after waking", async () => {
  let powerChanged: ((power: DesktopPowerState) => void) | undefined;
  let focusChanged: ((focused: boolean) => void) | undefined;
  let stateChanged:
    | ((state: Awaited<ReturnType<DesktopBridge["getState"]>>) => void)
    | undefined;
  const stopPower = jest.fn();
  window.electrifyDesktop = {
    apiVersion: 1,
    onGameFocusChanged: (listener: (focused: boolean) => void) => {
      focusChanged = listener;
      return () => {};
    },
    onPowerStateChanged: (listener: (power: DesktopPowerState) => void) => {
      powerChanged = listener;
      return stopPower;
    },
    onStateChanged: (
      listener: (state: Awaited<ReturnType<DesktopBridge["getState"]>>) => void,
    ) => {
      stateChanged = listener;
      return () => {};
    },
    onBeforeQuit: () => () => {},
    getState: jest.fn().mockResolvedValue({
      steam: {},
      power: { phase: "awake", generation: 0 },
    }),
    setActivity: jest.fn().mockResolvedValue(undefined),
  } as unknown as DesktopBridge;
  store.dispatch(gameDelta({ inGame: true, speed: "NORMAL" }));
  store.dispatch(change({ audioEnabled: true }));
  const view = render(
    <Provider store={store}>
      <App />
    </Provider>,
  );
  try {
    expect(powerChanged).toBeDefined();
    await act(async () => powerChanged!({ phase: "suspended", generation: 1 }));
    expect(store.getState().game.speed).toBe("PAUSED");
    (resume as jest.Mock).mockClear();
    act(() => {
      focusChanged!(true);
      window.dispatchEvent(new Event("pageshow"));
      powerChanged!({ phase: "resuming", generation: 2 });
    });
    expect(resume).not.toHaveBeenCalled();
    expect(store.getState().game.speed).toBe("PAUSED");
    act(() => {
      powerChanged!({ phase: "awake", generation: 2 });
      focusChanged!(true);
    });
    expect(resume).toHaveBeenCalled();
    expect(store.getState().game.speed).toBe("PAUSED");
    // A getState response captured before the wake acknowledgement must not hide us again.
    act(() =>
      stateChanged!({
        steam: {},
        power: { phase: "resuming", generation: 2 },
      } as Awaited<ReturnType<DesktopBridge["getState"]>>),
    );
    expect(store.getState().game.speed).toBe("PAUSED");
  } finally {
    view.unmount();
    delete window.electrifyDesktop;
    store.dispatch(quit());
  }
  expect(stopPower).toHaveBeenCalledTimes(1);
});
