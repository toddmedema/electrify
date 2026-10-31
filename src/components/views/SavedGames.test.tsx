import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import {
  act,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import savesReducer, {
  initialSaveLibrary,
  SaveLibraryState,
  libraryLoaded,
} from "../../SaveLibrary";
import { SaveMetadata, SavedRunResult } from "../../Types";
import {
  deleteSavedGame,
  readSavedGame,
  resumeSavedGame,
  retryCurrentSave,
  exportSaveRecovery,
} from "../../SaveSession";
import SavedGames from "./SavedGames";
import uiReducer from "../../reducers/UI";
import { reportSaveDeleteFailure } from "../../SaveDiagnostics";

jest.mock("../../SaveDiagnostics", () => ({
  reportSaveDeleteFailure: jest.fn(),
}));

jest.mock("../../SaveSession", () => ({
  saveSessionMiddleware:
    () => (next: (action: unknown) => unknown) => (action: unknown) =>
      next(action),
  deleteSavedGame: jest.fn(async () => undefined),
  exportCurrentSave: jest.fn(async () => undefined),
  exportSavedGame: jest.fn(async () => undefined),
  exportSaveRecovery: jest.fn(async () => undefined),
  importSavedGame: jest.fn(async () => undefined),
  readSavedGame: jest.fn(),
  refreshSavedGames: jest.fn(async () => undefined),
  resumeSavedGame: jest.fn(async () => true),
  retryCurrentSave: jest.fn(async () => true),
  runSaveTransition: jest.fn(),
}));

function entry(overrides: Partial<SaveMetadata> = {}): SaveMetadata {
  return {
    id: "wind",
    name: "Wind experiment",
    createdAt: "2026-10-01T12:00:00.000Z",
    lastPlayedAt: "2026-10-01T12:00:00.000Z",
    savedAt: "2026-10-01T12:01:00.000Z",
    revision: 1,
    status: "inProgress",
    scenarioId: 101,
    scenarioName: "Rise of Renewables",
    locationName: "Ontario",
    difficulty: "Manager",
    date: { month: "Jun", year: 2035 },
    ...overrides,
  };
}
function renderLibrary(overrides: Partial<SaveLibraryState> = {}) {
  const testStore = configureStore({
    reducer: {
      saves: savesReducer,
      game: () => ({ inGame: true }),
      ui: uiReducer,
    },
    preloadedState: {
      saves: {
        ...initialSaveLibrary,
        loading: false,
        entries: [entry()],
        ...overrides,
      },
    },
  });
  return {
    ...render(
      <Provider store={testStore}>
        <SavedGames />
      </Provider>,
    ),
    testStore,
  };
}

beforeEach(() => jest.clearAllMocks());

it("shows game date, difficulty and location above the saved date and time", () => {
  renderLibrary();
  const row = screen.getByRole("article", { name: "Wind experiment" });
  expect(
    within(row).getByText("Jun 2035 - Manager - Ontario"),
  ).toBeInTheDocument();
  expect(within(row).queryByText("Rise of Renewables")).not.toBeInTheDocument();
  expect(within(row).queryByText("In progress")).not.toBeInTheDocument();
  const time = within(row).getByLabelText(
    `Saved ${new Date(entry().savedAt).toLocaleString()}`,
  );
  expect(time).toHaveAttribute("datetime", entry().savedAt);
  expect(time).toHaveTextContent(
    `Saved ${new Date(entry().savedAt).toLocaleString()}`,
  );
});

it("preserves player-authored titles and completed outcomes", () => {
  renderLibrary({
    entries: [
      entry({ name: "Wind experiment — Ontario", status: "completed" }),
    ],
  });
  expect(
    screen.getByRole("heading", { name: "Wind experiment — Ontario" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Completed")).toBeInTheDocument();
});

it("shows an empty library without search", () => {
  renderLibrary({ entries: [] });
  expect(
    screen.queryByRole("textbox", { name: "Search saves" }),
  ).not.toBeInTheDocument();
  expect(screen.queryAllByRole("article")).toHaveLength(0);
  expect(screen.getByText("No saved games yet")).toBeVisible();
});

it("searches names and scenarios without opening a save", async () => {
  const { testStore } = renderLibrary({
    entries: [
      entry(),
      entry({ id: "second", name: "Backup", scenarioName: "Deregulation" }),
      entry({ id: "third", name: "Solar experiment" }),
      entry({ id: "fourth", name: "Gas experiment" }),
    ],
  });
  await userEvent.type(
    screen.getByRole("textbox", { name: "Search saves" }),
    "deregulation",
  );
  expect(
    screen.queryByRole("article", { name: "Wind experiment" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("article", { name: "Backup" })).toBeInTheDocument();
  expect(resumeSavedGame).not.toHaveBeenCalled();
  act(() => {
    testStore.dispatch(
      libraryLoaded([entry(), entry({ id: "third" }), entry({ id: "fourth" })]),
    );
  });
  expect(
    screen.queryByRole("textbox", { name: "Search saves" }),
  ).not.toBeInTheDocument();
  expect(screen.getAllByRole("article")).toHaveLength(3);
});

it("offers Load for both the active game and other playable saves", async () => {
  renderLibrary({
    activeId: "wind",
    entries: [
      entry(),
      entry({
        id: "second",
        name: "Completed experiment",
        status: "completed",
      }),
    ],
  });
  expect(screen.queryByText(/Currently open/)).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Return to game|Resume/ }),
  ).not.toBeInTheDocument();
  await userEvent.click(
    within(screen.getByRole("article", { name: "Wind experiment" })).getByRole(
      "button",
      { name: "Load" },
    ),
  );
  expect(resumeSavedGame).toHaveBeenLastCalledWith("wind");
  await waitFor(() =>
    expect(screen.getAllByRole("button", { name: "Load" })[1]).toBeEnabled(),
  );
  await userEvent.click(
    within(
      screen.getByRole("article", { name: "Completed experiment" }),
    ).getByRole("button", { name: "Load" }),
  );
  expect(resumeSavedGame).toHaveBeenLastCalledWith("second");
});

it("keeps save actions separate from Load and focuses Cancel for deletion", async () => {
  renderLibrary();
  await userEvent.click(
    screen.getByRole("button", { name: "Actions for Wind experiment" }),
  );
  expect(resumeSavedGame).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
  const dialog = screen.getByRole("dialog", { name: "Delete saved game?" });
  expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
  await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(deleteSavedGame).not.toHaveBeenCalled();
});

it("shows the unsaved current run even when the library is empty", async () => {
  renderLibrary({
    entries: [],
    activeId: "pending",
    pendingName: "New experiment",
    saveState: "failed",
    saveError: "Browser storage is full.",
  });
  expect(screen.queryByText("No saved games yet")).not.toBeInTheDocument();
  const current = screen.getByRole("article", { name: "Unsaved current game" });
  expect(within(current).getByText("New experiment")).toBeInTheDocument();
  expect(within(current).getByText("Unsaved")).toBeInTheDocument();
  expect(within(current).getByRole("button", { name: "Load" })).toBeEnabled();
  expect(screen.queryByText(/Currently open/)).not.toBeInTheDocument();
  await userEvent.click(
    within(current).getByRole("button", { name: "Retry save" }),
  );
  expect(retryCurrentSave).toHaveBeenCalledTimes(1);
});

it("views a terminal result with only Close and no gameplay transition", async () => {
  const terminal = entry({ status: "bankrupt" });
  const result: SavedRunResult = {
    scenarioId: 101,
    scenarioName: terminal.scenarioName,
    difficulty: terminal.difficulty,
    score: 50,
    breakdown: { supply: 50 },
    outcome: "bankrupt",
  };
  (readSavedGame as jest.Mock).mockResolvedValue({
    metadata: terminal,
    result,
  });
  renderLibrary({ entries: [terminal], activeId: terminal.id });
  await userEvent.click(screen.getByRole("button", { name: "View result" }));
  const dialog = await screen.findByRole("dialog", { name: "Bankrupt!" });
  expect(within(dialog).getAllByRole("button")).toHaveLength(1);
  await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Bankrupt!" }),
    ).not.toBeInTheDocument(),
  );
  expect(resumeSavedGame).not.toHaveBeenCalled();
});

it("keeps a corrupt entry visible with recovery and deletion while healthy games remain playable", async () => {
  renderLibrary({
    entries: [entry(), entry({ id: "healthy", name: "Healthy game" })],
    unavailable: {
      wind: {
        revision: 1,
        message: "Save unavailable. Download its recovery data or delete it.",
      },
    },
  });
  const corrupt = screen.getByRole("article", { name: "Wind experiment" });
  expect(within(corrupt).getByRole("button", { name: "Load" })).toBeDisabled();
  expect(
    within(screen.getByRole("article", { name: "Healthy game" })).getByRole(
      "button",
      { name: "Load" },
    ),
  ).toBeEnabled();
  await userEvent.click(
    within(corrupt).getByRole("button", {
      name: "Actions for Wind experiment",
    }),
  );
  await userEvent.click(
    screen.getByRole("menuitem", { name: "Download recovery data" }),
  );
  expect(exportSaveRecovery).toHaveBeenCalledWith("wind");
  expect(resumeSavedGame).not.toHaveBeenCalled();
});

async function confirmDelete() {
  fireEvent.click(
    screen.getByRole("button", { name: "Actions for Wind experiment" }),
  );
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
  await act(async () => {
    fireEvent.click(
      within(
        screen.getByRole("dialog", { name: "Delete saved game?" }),
      ).getByRole("button", { name: "Delete", exact: true }),
    );
  });
}

it("releases a hung deletion at six seconds, reports it and permits a fresh retry", async () => {
  jest.useFakeTimers();
  let finish!: () => void;
  (deleteSavedGame as jest.Mock).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const { testStore } = renderLibrary();
  await confirmDelete();
  const signal = (deleteSavedGame as jest.Mock).mock.calls[0][1] as AbortSignal;
  await act(async () => {
    jest.advanceTimersByTime(5999);
  });
  expect(screen.getByRole("button", { name: "Deleting…" })).toBeDisabled();
  expect(testStore.getState().ui.snackbar.open).toBe(false);
  await act(async () => {
    jest.advanceTimersByTime(1);
  });
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(signal.aborted).toBe(true);
  expect(screen.getByRole("button", { name: "Load" })).toBeEnabled();
  expect(testStore.getState().ui.snackbar.message).toBe(
    "Delete may have failed. Please try again later.",
  );
  expect(reportSaveDeleteFailure).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      timedOut: true,
      saveCount: 1,
      pendingSave: false,
    }),
  );
  let retryFinish!: () => void;
  (deleteSavedGame as jest.Mock).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        retryFinish = resolve;
      }),
  );
  await confirmDelete();
  expect(deleteSavedGame).toHaveBeenCalledTimes(2);
  // The old completion must not close or unlock this newer deletion.
  await act(async () => {
    finish();
  });
  expect(screen.getByRole("button", { name: "Deleting…" })).toBeDisabled();
  await act(async () => {
    retryFinish();
  });
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("keeps delete failures actionable and clears the deadline after success or failure", async () => {
  jest.useFakeTimers();
  const failure = new Error("Storage unavailable");
  (deleteSavedGame as jest.Mock).mockRejectedValueOnce(failure);
  const { testStore } = renderLibrary();
  await confirmDelete();
  expect(screen.getByText("Storage unavailable")).toBeVisible();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  expect(reportSaveDeleteFailure).toHaveBeenCalledWith(
    failure,
    expect.objectContaining({ timedOut: false }),
  );
  (deleteSavedGame as jest.Mock).mockResolvedValueOnce(undefined);
  fireEvent.click(screen.getByRole("button", { name: "Delete", exact: true }));
  await act(async () => undefined);
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await act(async () => {
    jest.advanceTimersByTime(6000);
  });
  expect(testStore.getState().ui.snackbar.open).toBe(false);
});

it("cancels deletion on unmount without reporting or a late toast", async () => {
  let reject!: (error: Error) => void;
  (deleteSavedGame as jest.Mock).mockImplementationOnce(
    () =>
      new Promise<void>((_, no) => {
        reject = no;
      }),
  );
  const { unmount, testStore } = renderLibrary();
  await confirmDelete();
  const signal = (deleteSavedGame as jest.Mock).mock.calls[0][1] as AbortSignal;
  unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => {
    reject(new Error("Late rejection"));
  });
  expect(reportSaveDeleteFailure).not.toHaveBeenCalled();
  expect(testStore.getState().ui.snackbar.open).toBe(false);
});
