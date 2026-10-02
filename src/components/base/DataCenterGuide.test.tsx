import * as React from "react";
import { configureStore, UnknownAction } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  getPlayedScenarioIds,
  getScenarioPlayCounts,
  recordScenarioPlayed,
} from "../../LocalStorage";
import { TUTORIALS } from "../../data/Scenarios";
import { setSpeed } from "../../reducers/Game";
import uiReducer, { delta, dialogOpen, dialogClose } from "../../reducers/UI";
import DataCenterGuide from "./DataCenterGuide";
import { SpeedType } from "../../Types";

function mount({
  requested = true,
  inGame = true,
  replaying = false,
  blocked = false,
} = {}) {
  const testStore = configureStore({
    reducer: {
      ui: uiReducer,
      user: () => ({}),
      game: (
        state: {
          inGame: boolean;
          replayPlayback: boolean;
          speed: SpeedType;
        } = { inGame, replayPlayback: replaying, speed: "NORMAL" },
        action: UnknownAction,
      ) => {
        if (setSpeed.match(action)) return { ...state, speed: action.payload };
        if (action.type === "game/loaded") return { ...state, inGame: true };
        if (action.type === "game/quit") return { ...state, inGame: false };
        return state;
      },
    },
  });
  testStore.dispatch(delta({ dataCenterGuideRequested: requested }));
  if (blocked)
    testStore.dispatch(
      dialogOpen({ open: true, title: "Other prompt", message: "" }),
    );
  render(
    <Provider store={testStore}>
      <React.StrictMode>
        <DataCenterGuide />
      </React.StrictMode>
    </Provider>,
  );
  return testStore;
}

beforeEach(() => localStorage.clear());

it("waits for a launched grid and any other dialog before recording the offer once", () => {
  const testStore = mount({ inGame: false, blocked: true });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(getPlayedScenarioIds()).toEqual([]);
  act(() => {
    testStore.dispatch({ type: "game/loaded" });
  });
  expect(getPlayedScenarioIds()).toEqual([]);
  act(() => {
    testStore.dispatch(dialogClose());
  });
  expect(
    screen.getByRole("dialog", { name: "New to Electrify?" }),
  ).toBeVisible();
  expect(testStore.getState().game.speed).toBe("PAUSED");
  expect(getScenarioPlayCounts()[TUTORIALS[0].id]).toBe(1);
  expect(testStore.getState().ui.dataCenterGuideRequested).toBe(false);
});

it.each(["skip", "escape", "backdrop"])(
  "dismisses by %s and leaves time paused and Mission 1 recorded",
  async (method) => {
    const testStore = mount();
    const dialog = screen.getByRole("dialog");
    if (method === "skip")
      fireEvent.click(screen.getByRole("button", { name: "Skip tutorial" }));
    if (method === "escape")
      fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" });
    if (method === "backdrop") {
      // MUI dismisses only a press that starts on the dialog's backdrop container.
      // eslint-disable-next-line testing-library/no-node-access
      const backdrop = dialog.closest(".MuiDialog-container")!;
      fireEvent.mouseDown(backdrop);
      fireEvent.click(backdrop);
    }
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(testStore.getState().game.speed).toBe("PAUSED");
    expect(getScenarioPlayCounts()[TUTORIALS[0].id]).toBe(1);
  },
);

it("supports back, next and completion without changing the game beyond pausing", async () => {
  const testStore = mount();
  const before = testStore.getState().game;
  fireEvent.click(screen.getByRole("button", { name: "Show me the basics" }));
  expect(screen.getByText("1 of 4")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("2 of 4")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByText("1 of 4")).toBeVisible();
  for (let step = 0; step < 3; step++)
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText(/Choose 1× at the top/)).toBeVisible();
  expect(screen.getByText(/You may need to raise rates/)).toHaveTextContent(
    "You may need to raise rates to expand infrastructure without going bankrupt.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Ready to explore" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(testStore.getState().game).toEqual(before);
  expect(getScenarioPlayCounts()[TUTORIALS[0].id]).toBe(1);
});

it("does not reoffer to someone who has played Mission 1", () => {
  recordScenarioPlayed(TUTORIALS[0].id);
  const testStore = mount();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(testStore.getState().game.speed).toBe("NORMAL");
  expect(getScenarioPlayCounts()[TUTORIALS[0].id]).toBe(1);
});

it.each([{ requested: false }, { replaying: true }])(
  "does not offer outside a new data center launch: %p",
  (options) => {
    mount(options);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(getPlayedScenarioIds()).toEqual([]);
  },
);

it("hides during another prompt and when the run ends", async () => {
  const testStore = mount();
  act(() => {
    testStore.dispatch(
      dialogOpen({ open: true, title: "Other prompt", message: "" }),
    );
  });
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  act(() => {
    testStore.dispatch(dialogClose());
  });
  expect(screen.getByRole("dialog")).toBeVisible();
  act(() => {
    testStore.dispatch({ type: "game/quit" });
  });
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
});
