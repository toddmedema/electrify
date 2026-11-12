import { configureStore } from "@reduxjs/toolkit";
import { store } from "../Store";
import gameReducer, { setSpeed, tick, buildFacility } from "../reducers/Game";
import cardReducer, { navigate } from "../reducers/Card";
import uiReducer, {
  dialogOpen,
  dialogClose,
  setFacilityDragActive,
} from "../reducers/UI";
import {
  multiplayerSnapshot,
  systemSuspend,
  pageHidden,
  pageVisible,
} from "../reducers/GameActions";
import { multiplayerMiddleware, registerMultiplayerRuntime } from "./Registry";

afterEach(() => {
  registerMultiplayerRuntime(undefined);
  jest.clearAllTimers();
  jest.useRealTimers();
});

function fixture() {
  jest.useFakeTimers();
  const initial = store.getState();
  const local = configureStore({
    reducer: (state = initial, action) => ({
      ...state,
      game: gameReducer(state.game, action),
      card: cardReducer(state.card, action),
      ui: uiReducer(state.ui, action),
    }),
    middleware: (getDefault) =>
      getDefault({ serializableCheck: false, immutableCheck: false }).concat(
        multiplayerMiddleware,
      ),
  });
  const runtime = {
    command: jest.fn(),
    submit: jest.fn(),
    activity: jest.fn(),
    leave: jest.fn(),
  };
  registerMultiplayerRuntime(runtime);
  local.dispatch(
    multiplayerSnapshot({
      ...initial.game,
      multiplayer: {
        seat: "self",
        clock: {
          activeSpeed: "SLOW",
          selectedSpeed: "ULTRA",
          players: [],
          reason: "",
          readyRequired: false,
          ready: false,
        },
      },
    }),
  );
  return { local, runtime };
}

test("nested dialogs and reading cards keep the shared pause until every local blocker closes", () => {
  const { local, runtime } = fixture();
  local.dispatch(navigate("SETTINGS"));
  expect(runtime.activity).toHaveBeenLastCalledWith("Reading settings");
  local.dispatch(
    dialogOpen({ open: true, title: "Notice", message: "Read this" }),
  );
  expect(runtime.activity).toHaveBeenLastCalledWith("Reading notification");
  local.dispatch(dialogClose());
  expect(runtime.activity).toHaveBeenLastCalledWith("Reading settings");
  local.dispatch(navigate("FACILITIES"));
  expect(runtime.activity).toHaveBeenLastCalledWith(null);
  expect(local.getState().game.multiplayer!.clock!.selectedSpeed).toBe("ULTRA");
});

test("opening the build menu does not pause the shared clock for anyone", () => {
  const { local, runtime } = fixture();
  for (const card of [
    "BUILD_GENERATORS",
    "BUILD_STORAGE",
    "BUILD_INTERTIES",
  ] as const) {
    local.dispatch(navigate(card));
    expect(runtime.activity).toHaveBeenLastCalledWith(null);
    // The catalog shows the clock the world is running, never a local pause.
    expect(local.getState().game.speed).toBe("SLOW");
  }
  local.dispatch(navigate("FACILITIES"));
  expect(local.getState().game.speed).toBe("SLOW");
  // Leaving a reading card for the build menu hands the clock back too.
  local.dispatch(navigate("SETTINGS"));
  expect(runtime.activity).toHaveBeenLastCalledWith("Reading settings");
  local.dispatch(navigate("BUILD_GENERATORS"));
  expect(runtime.activity).toHaveBeenLastCalledWith(null);
  expect(local.getState().game.speed).toBe("SLOW");
  expect(
    runtime.command.mock.calls.filter(([command]) => command.kind === "speed"),
  ).toEqual([]);
});

test("a window sent to the background does not pause the shared clock", () => {
  const { local, runtime } = fixture();
  local.dispatch(pageHidden());
  expect(runtime.activity).toHaveBeenLastCalledWith(null);
  expect(local.getState().game.speed).toBe("SLOW");
  local.dispatch(navigate("BUILD_GENERATORS"));
  expect(runtime.activity).toHaveBeenLastCalledWith(null);
  local.dispatch(pageVisible());
  expect(runtime.activity).toHaveBeenLastCalledWith(null);
  expect(local.getState().game.speed).toBe("SLOW");
});

test("ordinary economic actions reach the host, and renderer ticks never advance a shared grid", () => {
  const { local, runtime } = fixture();
  const before = local.getState().game;
  local.dispatch(
    buildFacility({ facility: { name: "Wind" }, financed: true } as Parameters<
      typeof buildFacility
    >[0]),
  );
  expect(runtime.command).toHaveBeenLastCalledWith(
    expect.objectContaining({ kind: "action", name: "buildFacility" }),
  );
  expect(local.getState().game).toBe(before);
  local.dispatch(tick());
  expect(local.getState().game.date).toEqual(before.date);
  local.dispatch(setSpeed("NORMAL"));
  expect(runtime.command).toHaveBeenLastCalledWith({
    kind: "speed",
    speed: "NORMAL",
  });
  local.dispatch(setFacilityDragActive(true));
  expect(runtime.activity).toHaveBeenLastCalledWith("Reordering facilities");
  const commands = runtime.command.mock.calls.length;
  local.dispatch(setSpeed("PAUSED"));
  expect(runtime.command).toHaveBeenCalledTimes(commands);
  local.dispatch(setFacilityDragActive(false));
  expect(runtime.activity).toHaveBeenLastCalledWith(null);
});

test("system sleep submits a persistent shared pause instead of an automatic background pause", () => {
  const { local, runtime } = fixture();
  local.dispatch(systemSuspend());
  expect(runtime.command).toHaveBeenLastCalledWith({
    kind: "speed",
    speed: "PAUSED",
  });
});
