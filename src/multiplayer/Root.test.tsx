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
    canLeaveInterruption: () => false,
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

test("an incoming Steam link fills the join prompt and waits for consent", async () => {
  const { join, invite } = renderWithSteamInvites();
  await invite(invitation);
  expect(join).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: "Invite code" })).toHaveValue(
    invitation,
  );
  await userEvent.click(screen.getByRole("button", { name: "Join" }));
  expect(join).toHaveBeenCalledWith(invitation);
});

test("the unified lobby accepts a pasted link and a code", async () => {
  const { join } = renderWithSteamInvites();
  const user = userEvent.setup();
  act(showMultiplayerLobby);
  const title = screen.getByRole("heading", { name: "Play with friends" });
  await waitFor(() => expect(title).toHaveFocus());
  const code = screen.getByRole("textbox", { name: "Invite code" });
  await user.type(
    code,
    "https://electrifygame.com/invite/#invite=" + invitation,
  );
  await user.click(screen.getByRole("button", { name: "Join" }));
  expect(join).toHaveBeenCalledWith(invitation);
  await user.clear(code);
  await user.type(code, "001122334455AABBCCDD");
  await user.click(screen.getByRole("button", { name: "Join" }));
  expect(join).toHaveBeenLastCalledWith("001122334455aabbccdd");
});

test("Steam Offline Mode disables online play and keeps Local Co-op available", async () => {
  const { join, invite } = renderWithSteamInvites(false);
  await invite(invitation);
  expect(screen.getByRole("button", { name: "Host a game" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Join" })).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Multiplayer saves" }),
  ).toBeDisabled();
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
  expect(screen.getByRole("textbox", { name: "Invite code" })).toHaveValue(
    newerInvitation,
  );
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
