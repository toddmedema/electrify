import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import * as desktop from "../Desktop";
import { useDesktopState } from "../DesktopState";
import { store } from "../Store";
import { quit } from "../reducers/GameActions";
import { createGame } from "../testing/Simulator";
import { MultiplayerSession, SessionState } from "./Session";
import { showMultiplayerLobby } from "./Registry";
import MultiplayerRoot from "./Root";
import { CrossplayApiError } from "./CrossplayApi";

jest.mock("../DesktopState", () => ({ useDesktopState: jest.fn() }));
jest.mock("./WorkerClient", () => ({}));
jest.mock("./Session", () => ({
  ...jest.requireActual("./Session"),
  MultiplayerSession: jest.fn(),
}));
jest.mock("../couch/Root", () => ({ onClose }: { onClose: () => void }) => (
  <button onClick={onClose}>Leave couch setup</button>
));
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
  sessionStorage.clear();
  jest.mocked(useDesktopState).mockReset();
  jest.restoreAllMocks();
  store.dispatch(quit());
});

function renderRoot(
  initialize: MultiplayerSession["initialize"] = async () => {},
) {
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
    initialize,
    onlineCampaigns: true,
    canLeaveInterruption: jest.fn(() => false),
    hasStoppedReplica: () => false,
    dispose: () => {},
    setActivity: () => {},
    join: jest.fn().mockResolvedValue(undefined),
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
  return { session, notify, unmount };
}

const invitation = "abcdefghijklmnopqrstuv";
const newerInvitation = "zyxwvutsrqponmlkjihgfe";

function renderWithSteamInvites(online = true) {
  jest.mocked(useDesktopState).mockReturnValue({
    display: { width: 1280, height: 720, fullscreen: false, resolutions: [] },
    steam: { available: true, online, cloudEnabled: false },
  });
  let receive: (() => void) | undefined;
  let token: string | undefined;
  const bridge: Pick<
    desktop.DesktopBridge,
    | "apiVersion"
    | "couchRequest"
    | "steamEdition"
    | "crossplayRequest"
    | "onCrossplayInvite"
    | "takeCrossplayInvite"
  > = {
    apiVersion: 1,
    steamEdition: true,
    crossplayRequest: jest.fn(),
    couchRequest: jest.fn(),
    onCrossplayInvite: (callback) => {
      receive = callback;
      return () => {};
    },
    takeCrossplayInvite: async () => {
      const pending = token;
      token = undefined;
      return pending;
    },
  };
  jest
    .spyOn(desktop, "getDesktop")
    .mockReturnValue(bridge as desktop.DesktopBridge);
  const { session } = renderRoot();
  const invite = async (value: string) => {
    token = value;
    await act(async () => receive?.());
  };
  return { join: session.join, invite };
}

test("an incoming Steam link opens a join prompt without exposing its token", async () => {
  const { join, invite } = renderWithSteamInvites();
  await invite(invitation);
  expect(join).not.toHaveBeenCalled();
  const dialog = screen.getByRole("dialog", { name: "Play with friends" });
  expect(
    screen.queryByRole("textbox", { name: "Invite code" }),
  ).not.toBeInTheDocument();
  expect(dialog.outerHTML).not.toContain(invitation);
  await userEvent.click(screen.getByRole("button", { name: "Join" }));
  expect(join).toHaveBeenCalledWith(invitation);
});

test("an invalid link can be replaced with a manual code", async () => {
  const { join, invite } = renderWithSteamInvites();
  const user = userEvent.setup();
  join.mockRejectedValueOnce(new CrossplayApiError("invalid_invite"));
  await invite(invitation);
  await user.click(screen.getByRole("button", { name: "Join" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This invitation is no longer available.",
  );
  await user.click(screen.getByRole("button", { name: "Enter another code" }));
  const code = screen.getByRole("textbox", { name: "Invite code" });
  expect(code).toHaveValue("");
  await user.type(code, "A1Z2Q3");
  await user.click(screen.getByRole("button", { name: "Join" }));
  expect(join).toHaveBeenLastCalledWith("a1z2q3");
});

test("the unified lobby accepts a pasted link and a code", async () => {
  const { join } = renderWithSteamInvites();
  const user = userEvent.setup();
  act(showMultiplayerLobby);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Host a game" })).toHaveFocus(),
  );
  const code = screen.getByRole("textbox", { name: "Invite code" });
  await user.type(
    code,
    "https://electrifygame.com/invite/#invite=" + invitation,
  );
  await user.click(screen.getByRole("button", { name: "Join" }));
  expect(join).toHaveBeenCalledWith(invitation);
  await user.clear(code);
  await user.type(code, "AA1B2Z");
  await user.click(screen.getByRole("button", { name: "Join" }));
  expect(join).toHaveBeenLastCalledWith("aa1b2z");
});

test("Steam Offline Mode disables online play and keeps Local Co-op available", async () => {
  const { join } = renderWithSteamInvites(false);
  act(showMultiplayerLobby);
  expect(screen.getByRole("button", { name: "Host a game" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Join" })).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: "Multiplayer saves" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Local Co-op" })).toBeEnabled();
  expect(join).not.toHaveBeenCalled();
});

test("a couch session keeps the latest invitation until local play closes", async () => {
  const { join, invite } = renderWithSteamInvites();
  const user = userEvent.setup();
  act(showMultiplayerLobby);
  await user.click(screen.getByRole("button", { name: "Local Co-op" }));
  const leave = screen.getByRole("button", { name: "Leave couch setup" });
  await invite(invitation);
  await invite(newerInvitation);
  expect(join).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("dialog", { name: "Play with friends" }),
  ).not.toBeInTheDocument();
  await user.click(leave);
  expect(leave).not.toBeInTheDocument();
  expect(join).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("textbox", { name: "Invite code" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("dialog", { name: "Play with friends" }).outerHTML,
  ).not.toContain(newerInvitation);
  await user.click(screen.getByRole("button", { name: "Join" }));
  expect(join).toHaveBeenCalledWith(newerInvitation);
});

test("session status notifications do not replay a grid before sending the player's command", async () => {
  const { session, notify, unmount } = renderRoot();
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
  await notify({
    lobby: { ...session.getSnapshot().lobby, connected: ["guest"] },
  });
  expect(store.getState().game).toBe(applied);
  await notify({
    view: {
      ...session.getSnapshot().view!,
      game: { ...game, dollarsPerkWh: 0.15 },
    },
  });
  expect(store.getState().game.dollarsPerkWh).toBe(0.15);
  unmount();
});

test("an unavailable guest room offers only the main menu and makes no save promise", async () => {
  const { session, notify } = renderRoot();
  session.canLeaveInterruption.mockReturnValue(true);
  await notify({
    view: {
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
    lobby: {
      available: true,
      members: [],
      connected: [],
      error: "This multiplayer room is no longer available.",
    },
  });
  const dialog = screen.getByRole("dialog", {
    name: "Multiplayer session ended",
  });
  expect(dialog).toHaveAccessibleDescription(
    "The multiplayer room is no longer available. Host a game from Play with friends, then choose Load multiplayer save.",
  );
  expect(screen.getAllByRole("button")).toHaveLength(1);
  expect(
    screen.getByRole("button", { name: "Return to main menu" }),
  ).toBeVisible();
});
