import * as React from "react";
import { act, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import type { StateProps } from "./NewGameDetails";
import { achievementJournal } from "../../achievements/Journal";
import { recordIntent } from "../../achievements/Progress";
import type { AppStateType } from "../../Types";
import NewGameDetailsContainer, {
  mapDispatchToProps,
  mapStateToProps,
} from "./NewGameDetailsContainer";
import { store } from "../../Store";

jest.mock("./NewGameDetails", () => ({
  __esModule: true,
  default: ({ game, unlockedThrough }: StateProps) =>
    `${game.difficulty}/${unlockedThrough}`,
}));

jest.mock("./StartGame", () => ({
  startWithSaveGuard: (_dispatch: unknown, start: () => void) => start(),
}));
jest.mock("../../Store", () => ({ store: { getState: jest.fn() } }));
jest.mock("../../reducers/Game", () => ({
  start: (scenarioId: number) => ({ type: "start", scenarioId }),
  quit: () => ({ type: "quit" }),
  delta: (value: unknown) => ({ type: "delta", payload: value }),
}));
const state = {
  game: { difficulty: "CEO", scenarioId: 100 },
  ui: {},
  user: {},
} as AppStateType;
beforeEach(() => {
  localStorage.clear();
  achievementJournal.refresh();
  (store.getState as jest.Mock).mockReturnValue(state);
});

it("previews and launches the same unlocked level when a remembered choice is locked", () => {
  expect(mapStateToProps(state).game.difficulty).toBe("Intern");
  const dispatch = jest.fn();
  const controls = mapDispatchToProps(dispatch);
  controls.onDelta({ difficulty: "CEO" });
  expect(dispatch).not.toHaveBeenCalled();
  controls.onStart(100);
  expect(dispatch).toHaveBeenCalledWith({
    type: "delta",
    payload: { difficulty: "Intern" },
  });
  expect(dispatch).toHaveBeenCalledWith({ type: "start", scenarioId: 100 });
});

it("uses newly earned history for launch and accepts unlocked selections", () => {
  achievementJournal.merge(
    recordIntent({
      earned: [],
      completion: { scenarioId: 101, difficulty: "Intern" },
    }),
  );
  expect(mapStateToProps(state).game.difficulty).toBe("Employee");
  const dispatch = jest.fn();
  mapDispatchToProps(dispatch).onDelta({ difficulty: "Employee" });
  expect(dispatch).toHaveBeenCalledWith(
    expect.objectContaining({ payload: { previewDifficulty: "Employee" } }),
  );
  mapDispatchToProps(dispatch).onStart(100);
  expect(dispatch).toHaveBeenCalledWith({
    type: "delta",
    payload: { difficulty: "Employee" },
  });
});

it("shows a co-op guest the host's difficulty", () => {
  const guest = {
    ...state,
    ui: { coop: { role: "guest" }, previewDifficulty: "VP" },
  } as AppStateType;
  expect(mapStateToProps(guest).game.difficulty).toBe("VP");
});

it("updates the connected picker immediately when synced wins unlock another level", () => {
  const appStore = configureStore({ reducer: () => state });
  render(
    <Provider store={appStore}>
      <NewGameDetailsContainer />
    </Provider>,
  );
  expect(screen.getByText("Intern/Intern")).toBeInTheDocument();
  act(() => {
    achievementJournal.merge(
      recordIntent({
        earned: [],
        completion: { scenarioId: 100, difficulty: "Intern" },
      }),
    );
  });
  expect(screen.getByText("Employee/Employee")).toBeInTheDocument();
});
