import { configureStore, Middleware } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createSharedSave, loadSharedSave } from "../../CloudSaveTransport";
import { firebaseAppAuth, login } from "../../Globals";
import {
  importSavedGame,
  resumeSavedGame,
  snapshotSavedGame,
} from "../../SaveSession";
import savesReducer, {
  initialSaveLibrary,
  SaveLibraryState,
  sessionChanged,
} from "../../SaveLibrary";
import { downloadCloudRecovery, retryCloudSync } from "../../CloudSaves";
import { refreshToUpdate } from "../../helpers/Cache";
import { SaveRepositoryError } from "../../SaveModel";
import ShareSaveDialog from "./ShareSaveDialog";
import SharedGameDialog from "./SharedGameDialog";
import CloudSavePrompt, { CLOUD_PROMPT_KEY } from "./CloudSavePrompt";
import CloudSaveStatus from "./CloudSaveStatus";

jest.mock("../../Store", () => {
  const redux = jest.requireActual("react-redux");
  return {
    useAppDispatch: redux.useDispatch,
    useAppSelector: redux.useSelector,
  };
});
jest.mock("../../Globals", () => ({
  firebaseAppAuth: { currentUser: null },
  login: jest.fn(async () => false),
  getLocalStorage: () => globalThis.localStorage,
}));
jest.mock("../../SaveSession", () => ({
  importSavedGame: jest.fn(),
  resumeSavedGame: jest.fn(),
  snapshotSavedGame: jest.fn(),
}));
jest.mock("../../CloudSaveTransport", () => ({
  createSharedSave: jest.fn(),
  loadSharedSave: jest.fn(),
}));
jest.mock("../../helpers/Cache", () => ({ refreshToUpdate: jest.fn() }));
jest.mock("../../CloudSaves", () => ({
  downloadCloudRecovery: jest.fn(),
  retryCloudSync: jest.fn(),
}));
jest.mock("../../reducers/Card", () => ({
  navigate: (payload: string) => ({ type: "card/navigate", payload }),
}));

// The transport owns domain validation; these fixtures exercise the UI's preview and actions.
const snapshot = {
  name: "Ontario renewables",
  status: "inProgress",
  save: {
    game: {
      location: { name: "Ontario" },
      difficulty: "Manager",
      date: { month: "Jun", year: 2035 },
    },
  },
};
const mockAuth = firebaseAppAuth as unknown as {
  currentUser: { uid: string } | null;
};
const mockSnapshot = snapshotSavedGame as jest.Mock;
const mockCreate = createSharedSave as jest.Mock;
const mockLoad = loadSharedSave as jest.Mock;
const mockImport = importSavedGame as jest.Mock;
const mockResume = resumeSavedGame as jest.Mock;
const mockLogin = login as jest.Mock;

function renderWithSaves(
  element: React.JSX.Element,
  state: Partial<SaveLibraryState> = {},
) {
  const actions: unknown[] = [];
  const recordActions: Middleware = () => (next) => (action) => {
    actions.push(action);
    return next(action);
  };
  const store = configureStore({
    reducer: { saves: savesReducer },
    preloadedState: { saves: { ...initialSaveLibrary, ...state } },
    middleware: (getDefault) => getDefault().concat(recordActions),
  });
  return {
    ...render(<Provider store={store}>{element}</Provider>),
    actions,
    store,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  mockAuth.currentUser = null;
  mockSnapshot.mockResolvedValue(snapshot);
  mockCreate.mockResolvedValue("https://electrifygame.com/?game=Abc123Xy90");
  mockLoad.mockResolvedValue(snapshot);
  mockImport.mockResolvedValue("shared-local-save");
  mockResume.mockResolvedValue(true);
  mockLogin.mockResolvedValue(false);
});

it("prepares one snapshot and creates a frozen share link after sign-in", async () => {
  const close = jest.fn();
  const user = userEvent.setup();
  render(<ShareSaveDialog id="local-save" onClose={close} />);
  const sharing = screen.getByRole("dialog", { name: "Share a frozen copy" });
  await waitFor(() =>
    expect(
      within(sharing).getByRole("button", { name: "Sign in and share" }),
    ).toBeEnabled(),
  );
  expect(mockSnapshot).toHaveBeenCalledTimes(1);
  expect(mockSnapshot).toHaveBeenCalledWith("local-save");
  expect(mockCreate).not.toHaveBeenCalled();
  mockLogin.mockImplementation(async () => {
    mockAuth.currentUser = { uid: "account" };
    return true;
  });
  await user.click(
    within(sharing).getByRole("button", { name: "Sign in and share" }),
  );
  expect(mockCreate).toHaveBeenCalledWith("account", snapshot);
  const link = await within(sharing).findByRole("textbox", {
    name: "Share link",
  });
  expect(link).toHaveValue("https://electrifygame.com/?game=Abc123Xy90");
  expect(link).toHaveAttribute("readonly");
  const clipboard = jest
    .spyOn(navigator.clipboard, "writeText")
    .mockResolvedValue(undefined);
  await user.click(within(sharing).getByRole("button", { name: "Copy link" }));
  expect(clipboard).toHaveBeenCalledWith(
    "https://electrifygame.com/?game=Abc123Xy90",
  );
  expect(await within(sharing).findByRole("status")).toHaveTextContent(
    "Link copied",
  );
  await user.click(within(sharing).getByRole("button", { name: "Close" }));
  expect(close).toHaveBeenCalledTimes(1);
  expect(mockSnapshot).toHaveBeenCalledTimes(1);
});

it("retains the frozen snapshot when link creation fails and can retry", async () => {
  mockAuth.currentUser = { uid: "account" };
  mockCreate.mockRejectedValueOnce(new Error("offline"));
  render(<ShareSaveDialog id="local-save" onClose={jest.fn()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Check your connection and try again",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Create share link" }),
  );
  await screen.findByRole("textbox", { name: "Share link" });
  expect(mockCreate).toHaveBeenCalledTimes(2);
  expect(mockCreate.mock.calls[1][1]).toBe(mockCreate.mock.calls[0][1]);
  expect(mockSnapshot).toHaveBeenCalledTimes(1);
});

it("offers manual copying when the clipboard is unavailable", async () => {
  const user = userEvent.setup();
  mockAuth.currentUser = { uid: "account" };
  render(<ShareSaveDialog id="local-save" onClose={jest.fn()} />);
  const link = await screen.findByRole("textbox", { name: "Share link" });
  jest
    .spyOn(navigator.clipboard, "writeText")
    .mockRejectedValue(new Error("clipboard blocked"));
  await user.click(screen.getByRole("button", { name: "Copy link" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Select and copy the link above",
  );
  expect(link).toHaveFocus();
  expect((link as HTMLInputElement).selectionEnd).toBe(
    (link as HTMLInputElement).value.length,
  );
});

it("does not publish after a cancelled sign-in", async () => {
  render(<ShareSaveDialog id="local-save" onClose={jest.fn()} />);
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Sign in and share" }),
    ).toBeEnabled(),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Sign in and share" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Sign-in didn't finish",
  );
  expect(mockCreate).not.toHaveBeenCalled();
});

it("discards a late share response when another saved game is opened", async () => {
  mockAuth.currentUser = { uid: "account" };
  let finish!: (url: string) => void;
  mockCreate.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<ShareSaveDialog id="first" onClose={jest.fn()} />);
  await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
  view.rerender(<ShareSaveDialog id="second" onClose={jest.fn()} />);
  await screen.findByRole("textbox", { name: "Share link" });
  await act(async () => finish("https://electrifygame.com/?game=Old123Abc9"));
  expect(screen.getByRole("textbox", { name: "Share link" })).toHaveValue(
    "https://electrifygame.com/?game=Abc123Xy90",
  );
});

it("previews a shared game before playing an independent copy and removing only its URL parameter", async () => {
  window.history.replaceState(null, "", "/?game=Abc123Xy90&scenario=101#start");
  const { actions } = renderWithSaves(<SharedGameDialog />);
  expect(
    await screen.findByRole("heading", { name: "Ontario renewables" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Ontario · Manager · Jun 2035")).toBeInTheDocument();
  expect(screen.queryByText(/This is a frozen copy/)).not.toBeInTheDocument();
  expect(mockImport).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Play" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(mockLoad).toHaveBeenCalledWith("Abc123Xy90");
  expect(mockImport).toHaveBeenCalledWith(snapshot);
  expect(mockResume).toHaveBeenCalledWith("shared-local-save");
  expect(actions).not.toContainEqual({
    type: "card/navigate",
    payload: "SAVED_GAMES",
  });
  expect(window.location.search).toBe("?scenario=101");
  expect(window.location.hash).toBe("#start");
});

it("keeps the shared preview open if device storage fails and allows another add attempt", async () => {
  window.history.replaceState(null, "", "/?game=Abc123Xy90");
  mockImport.mockRejectedValueOnce(new Error("quota"));
  renderWithSaves(<SharedGameDialog />);
  await screen.findByRole("heading", { name: "Ontario renewables" });
  await userEvent.click(screen.getByRole("button", { name: "Play" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Check device storage and try again",
  );
  expect(
    screen.getByRole("heading", { name: "Ontario renewables" }),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Play" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(mockImport).toHaveBeenCalledTimes(2);
  expect(mockLoad).toHaveBeenCalledTimes(1);
});

it("opens the save library for an unplayable shared result", async () => {
  window.history.replaceState(null, "", "/?game=Abc123Xy90");
  mockLoad.mockResolvedValue({ ...snapshot, status: "bankrupt" });
  const { actions } = renderWithSaves(<SharedGameDialog />);
  await screen.findByRole("heading", { name: "Ontario renewables" });
  await userEvent.click(screen.getByRole("button", { name: "Play" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(mockResume).not.toHaveBeenCalled();
  expect(actions).toContainEqual({
    type: "card/navigate",
    payload: "SAVED_GAMES",
  });
});

it("explains unavailable shared links and retries without importing anything", async () => {
  window.history.replaceState(null, "", "/?game=Abc123Xy90");
  mockLoad.mockRejectedValueOnce(
    new Error("This shared game has expired or is no longer available."),
  );
  renderWithSaves(<SharedGameDialog />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "expired or is no longer available",
  );
  expect(
    screen.queryByRole("button", { name: "Play" }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByRole("heading", { name: "Ontario renewables" });
  expect(mockImport).not.toHaveBeenCalled();
});

it("offers a one-click update for a game shared from a newer version", async () => {
  window.history.replaceState(null, "", "/?game=Abc123Xy90");
  mockLoad.mockRejectedValueOnce(
    new SaveRepositoryError(
      "incompatible",
      "This save needs a newer version of Electrify.",
    ),
  );
  renderWithSaves(<SharedGameDialog />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "shared from a newer version of Electrify",
  );
  expect(
    screen.queryByRole("button", { name: "Retry" }),
  ).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "Refresh to update" }),
  );
  expect(refreshToUpdate).toHaveBeenCalledTimes(1);
  expect(mockImport).not.toHaveBeenCalled();
});

it.each([
  ["synced", "Cloud backup up to date. Games load from this device."],
  [
    "offline",
    "You're offline. Games save on this device; cloud backup resumes when you reconnect.",
  ],
  ["syncing", "Syncing cloud backup. Games load from this device."],
] as const)(
  "describes %s cloud status without taking over local loading",
  (cloudState, message) => {
    renderWithSaves(<CloudSaveStatus />, { cloudState });
    expect(screen.getByRole("status")).toHaveTextContent(message);
  },
);

it("explains retained conflict copies and provides a cloud retry after failure", async () => {
  renderWithSaves(<CloudSaveStatus />, {
    cloudState: "failed",
    cloudError:
      "Cloud backup couldn't finish. Your device saves are still available.",
    cloudConflicts: true,
  });
  expect(screen.getByRole("alert")).toHaveTextContent("Both copies were kept");
  await userEvent.click(
    screen.getByRole("button", { name: "Retry cloud backup" }),
  );
  expect(retryCloudSync).toHaveBeenCalledTimes(1);
  await userEvent.click(
    within(screen.getByRole("alert")).getByRole("button", { name: "Close" }),
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("names incompatible backups and downloads recovery without offering a sync retry", async () => {
  const issue = { id: "old", version: "1", name: "Deep Freeze — Austin, TX" };
  renderWithSaves(<CloudSaveStatus />, {
    cloudState: "synced",
    cloudUid: "alice",
    incompatibleCloudSaves: [issue],
  });
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Some backups need the latest version",
  );
  expect(screen.getByRole("alert")).toHaveTextContent("safe in your account");
  await userEvent.click(
    screen.getByRole("button", { name: "Refresh to update" }),
  );
  expect(refreshToUpdate).toHaveBeenCalledTimes(1);
  expect(
    screen.queryByRole("button", { name: "Retry cloud backup" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(
    "Compatible cloud backups are up to date",
  );
  await userEvent.click(
    screen.getByRole("button", {
      name: `Download recovery file for ${issue.name}`,
    }),
  );
  expect(downloadCloudRecovery).toHaveBeenCalledWith(issue);
  expect(screen.getByText("Recovery file downloaded.")).toBeInTheDocument();
});

it("keeps genuine sync retries and recovery failures separate", async () => {
  (downloadCloudRecovery as jest.Mock).mockRejectedValueOnce(
    new Error("sensitive provider error"),
  );
  renderWithSaves(<CloudSaveStatus />, {
    cloudState: "failed",
    cloudUid: "alice",
    cloudError: "Some saves couldn't sync.",
    incompatibleCloudSaves: [{ id: "old", version: "1", name: "Old grid" }],
  });
  await userEvent.click(
    screen.getByRole("button", { name: "Download recovery file for Old grid" }),
  );
  expect(screen.getByText(/Couldn't download this backup/)).toBeInTheDocument();
  expect(screen.queryByText(/sensitive provider/)).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "Retry cloud backup" }),
  );
  expect(retryCloudSync).toHaveBeenCalledTimes(1);
});

const existingSave = {
  id: "device-save",
  name: "Local experiment",
  revision: 1,
  createdAt: "2026-10-01T12:00:00Z",
  savedAt: "2026-10-01T12:00:00Z",
  status: "inProgress" as const,
  scenarioId: 101,
  scenarioName: "Rise of Renewables",
  locationName: "Ontario",
  difficulty: "Manager" as const,
  date: { month: "Jun" as const, year: 2035 },
};

it("offers optional cloud sign-in only once after Save & Quit", async () => {
  const view = renderWithSaves(<CloudSavePrompt />, {
    cloudState: "signedOut",
    entries: [existingSave],
  });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(localStorage.getItem(CLOUD_PROMPT_KEY)).toBeNull();
  act(() =>
    view.store.dispatch(sessionChanged({ cloudPromptRequested: true })),
  );
  const invitation = screen.getByRole("dialog", {
    name: "Back up your saves to the cloud",
  });
  expect(invitation).toHaveTextContent("even offline");
  expect(localStorage.getItem(CLOUD_PROMPT_KEY)).toBe("true");
  await userEvent.click(
    within(invitation).getByRole("button", {
      name: "Continue without syncing",
    }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(mockLogin).not.toHaveBeenCalled();
  view.unmount();
  renderWithSaves(<CloudSavePrompt />, {
    cloudState: "signedOut",
    entries: [existingSave],
    cloudPromptRequested: true,
  });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("keeps the cloud invitation available after a cancelled sign-in", async () => {
  renderWithSaves(<CloudSavePrompt />, {
    cloudState: "signedOut",
    entries: [existingSave],
    cloudPromptRequested: true,
  });
  await userEvent.click(
    screen.getByRole("button", { name: "Sign in with Google" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Sign-in didn't finish",
  );
  expect(
    screen.getByRole("button", { name: "Continue without syncing" }),
  ).toBeEnabled();
});

it("does not interrupt shared links with the cloud invitation", () => {
  window.history.replaceState(null, "", "/?game=Abc123Xy90");
  renderWithSaves(<CloudSavePrompt />, {
    cloudState: "signedOut",
    entries: [existingSave],
    cloudPromptRequested: true,
  });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(localStorage.getItem(CLOUD_PROMPT_KEY)).toBeNull();
});
