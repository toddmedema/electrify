import { act, render } from "@testing-library/react";
import { Provider } from "react-redux";
import { store } from "../Store";
import { quit } from "../reducers/GameActions";
import { createGame } from "../testing/Simulator";
import { MultiplayerSession, SessionState } from "./Session";
import MultiplayerRoot from "./Root";

jest.mock("./WorkerClient", () => ({}));
jest.mock("./Session", () => ({
  ...jest.requireActual("./Session"),
  MultiplayerSession: jest.fn(),
}));
jest.mock("../couch/Root", () => () => null);
jest.mock("../helpers/WaitForLoad", () => ({
  waitForLoad: () => Promise.resolve(),
}));
jest.mock("../SaveSession", () => ({
  ...jest.requireActual("../SaveSession"),
  runSaveTransition: async (enter: () => void) => {
    enter();
    return true;
  },
}));

afterEach(() => {
  jest.restoreAllMocks();
  store.dispatch(quit());
});

test("session status notifications do not replay a grid before sending the player's command", async () => {
  const listeners = new Set<() => void>();
  let snapshot: SessionState = {
    lobby: { available: true, selfId: "host", members: [], connected: [] },
    pending: false,
    busy: false,
    waitingForHost: false,
    loadingSaves: false,
  };
  const session = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    initialize: async () => {},
    dispose: () => {},
    setActivity: () => {},
  };
  jest
    .mocked(MultiplayerSession)
    .mockImplementation(() => session as unknown as MultiplayerSession);
  const { unmount } = render(
    <Provider store={store}>
      <MultiplayerRoot />
    </Provider>,
  );
  const notify = async (update: Partial<SessionState>) => {
    await act(async () => {
      snapshot = { ...snapshot, ...update };
      listeners.forEach((listener) => listener());
    });
  };
  const game = createGame({ scenarioId: 101, seed: 12345 });
  game.multiplayer = { seat: "host" };
  await notify({
    view: {
      game,
      matchId: "match",
      epoch: "epoch",
      revision: 1,
      speed: "PAUSED",
      reason: "Paused",
      readyRequired: true,
      ready: [],
      disconnected: [],
      lastSequence: 0,
      grids: [],
    },
  });
  const applied = store.getState().game;
  expect(applied.multiplayer?.seat).toBe("host");
  await notify({ pending: true });
  expect(store.getState().game).toBe(applied);
  await notify({ lobby: { ...snapshot.lobby, connected: ["guest"] } });
  expect(store.getState().game).toBe(applied);
  await notify({
    view: { ...snapshot.view!, game: { ...game, dollarsPerkWh: 0.15 } },
  });
  expect(store.getState().game.dollarsPerkWh).toBe(0.15);
  unmount();
});
