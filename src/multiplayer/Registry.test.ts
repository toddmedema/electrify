import { configureStore } from "@reduxjs/toolkit";
import { store } from "../Store";
import gameReducer, { setSpeed, tick, buildFacility } from "../reducers/Game";
import cardReducer, { navigate } from "../reducers/Card";
import uiReducer, {
  dialogOpen,
  dialogClose,
  setFacilityDragActive,
} from "../reducers/UI";
import { multiplayerSnapshot } from "../reducers/GameActions";
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

test("normal nested dialogs and build navigation keep the shared pause until every local blocker closes", () => {
  const { local, runtime } = fixture();
  local.dispatch(navigate("BUILD_GENERATORS"));
  expect(runtime.activity).toHaveBeenLastCalledWith("Building capacity");
  local.dispatch(
    dialogOpen({ open: true, title: "Notice", message: "Read this" }),
  );
  expect(runtime.activity).toHaveBeenLastCalledWith("Reading notification");
  local.dispatch(dialogClose());
  expect(runtime.activity).toHaveBeenLastCalledWith("Building capacity");
  local.dispatch(navigate("FACILITIES"));
  expect(runtime.activity).toHaveBeenLastCalledWith(null);
  expect(local.getState().game.multiplayer!.clock!.selectedSpeed).toBe("ULTRA");
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
