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
import cardReducer, { navigate } from "../../reducers/Card";
import userEvent from "@testing-library/user-event";

function mount({
  requested = true,
  inGame = true,
  replaying = false,
  blocked = false,
  peakW = 100000000,
} = {}) {
  const testStore = configureStore({
    reducer: {
      card: cardReducer,
      ui: uiReducer,
      user: () => ({}),
      game: (
        state: {
          inGame: boolean;
          replayPlayback: boolean;
          speed: SpeedType;
          customScenario: {
            loadAdditions: { id: string; peakW: number; startsYear: number }[];
          };
        } = {
          inGame,
          replayPlayback: replaying,
          speed: "NORMAL",
          customScenario: {
            loadAdditions: [
              { id: "community-data-centers", peakW, startsYear: 2032 },
            ],
          },
        },
        action: UnknownAction,
      ) => {
        if (setSpeed.match(action)) return { ...state, speed: action.payload };
        if (action.type === "game/loaded") return { ...state, inGame: true };
        if (action.type === "game/quit") return { ...state, inGame: false };
        return state;
      },
    },
  });
  testStore.dispatch(navigate("FACILITIES"));
  testStore.dispatch(delta({ dataCenterGuideRequested: requested }));
  if (blocked)
    testStore.dispatch(
      dialogOpen({ open: true, title: "Other prompt", message: "" }),
    );
  render(
    <Provider store={testStore}>
      <React.StrictMode>
        <button
          id="buildNav"
          onClick={() => testStore.dispatch(navigate("BUILD_GENERATORS"))}
        >
          Build
        </button>
        <button
          id="tab-BUILD_STORAGE"
          onClick={() => testStore.dispatch(navigate("BUILD_STORAGE"))}
        >
          Storage
        </button>
        <button
          id="programsNav"
          onClick={() => testStore.dispatch(navigate("PROGRAMS"))}
        >
          Programs
        </button>
        <button aria-label="Efficiency rebates · Not started">
          Efficiency rebates
        </button>
        <button
          id="insightsNav"
          onClick={() => testStore.dispatch(navigate("INSIGHTS"))}
        >
          Insights
        </button>
        <button
          id="eventsNav"
          onClick={() => testStore.dispatch(navigate("EVENTS"))}
        >
          Events
        </button>
        <button
          id="scenarioNav"
          onClick={() => testStore.dispatch(navigate("SCENARIO"))}
        >
          Scenario
        </button>
        <button>Unrelated</button>
        <DataCenterGuide />
      </React.StrictMode>
    </Provider>,
  );
  return testStore;
}

beforeEach(() => localStorage.clear());

it.each([100000000, 0])(
  "explains the chosen data-center demand (%s W)",
  (peakW) => {
    mount({ peakW });
    fireEvent.click(screen.getByRole("button", { name: "Start tour" }));
    expect(
      screen.getByRole("region", { name: "Step 1 of 8" }),
    ).toHaveTextContent(
      peakW
        ? "New data centers add 100MW of demand in 2032."
        : "This run has no added data-center demand.",
    );
  },
);

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

it("uses the existing tutorial highlights and advances when the named controls are clicked", async () => {
  const testStore = mount();
  const user = userEvent.setup({ delay: null });
  const before = testStore.getState().game;
  await user.click(screen.getByRole("button", { name: "Start tour" }));
  expect(screen.getByRole("region", { name: "Step 1 of 8" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Build" })).toHaveClass(
    "tutorialTarget",
  );
  await user.click(screen.getByRole("button", { name: "Unrelated" }));
  expect(screen.getByRole("region", { name: "Step 1 of 8" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Build" }));
  expect(screen.getByRole("region", { name: "Step 2 of 8" })).toBeVisible();
  expect(testStore.getState().card.name).toBe("BUILD_GENERATORS");
  await user.click(screen.getByRole("button", { name: "Back" }));
  expect(testStore.getState().card.name).toBe("FACILITIES");
  // Keep the standard Next fallback as well as the click-to-advance route.
  await user.click(screen.getByRole("button", { name: "Next" }));
  expect(testStore.getState().card.name).toBe("BUILD_GENERATORS");
  const controls = [
    "Storage",
    "Programs",
    "Efficiency rebates · Not started",
    "Insights",
    "Events",
    "Scenario",
  ];
  for (let index = 0; index < controls.length; index++) {
    await user.click(screen.getByRole("button", { name: controls[index] }));
    await screen.findByRole("region", { name: `Step ${index + 3} of 8` });
  }
  expect(screen.getByRole("region", { name: "Step 8 of 8" })).toBeVisible();
  expect(testStore.getState().card.name).toBe("SCENARIO");
  await user.click(screen.getByRole("button", { name: "Finish tour" }));
  expect(
    screen.queryByRole("region", { name: "Step 8 of 8" }),
  ).not.toBeInTheDocument();
  expect(testStore.getState().card.name).toBe("FACILITIES");
  expect(testStore.getState().game).toEqual(before);
  expect(getScenarioPlayCounts()[TUTORIALS[0].id]).toBe(1);
});

it("keeps time paused while exploring tools and exits the tour with Escape", async () => {
  const testStore = mount();
  fireEvent.click(screen.getByRole("button", { name: "Start tour" }));
  act(() => {
    testStore.dispatch(setSpeed("FAST"));
  });
  expect(testStore.getState().game.speed).toBe("PAUSED");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(
    screen.queryByRole("region", { name: "Step 1 of 8" }),
  ).not.toBeInTheDocument();
  expect(testStore.getState().game.speed).toBe("PAUSED");
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
