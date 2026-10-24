import { act, render, screen } from "@testing-library/react";
import type { DesktopBridge, DesktopInputFrame } from "../Desktop";
import { store } from "../Store";
import { startDesktopInput } from "../desktop/Input";
import { restoreMenuFocus } from "../components/base/useMenuKeys";
import type { LobbyState, SharedSaveLibrary } from "./Native";
import { MultiplayerSession } from "./Session";
import Lobby from "./Lobby";
import SavesDialog from "./SavesDialog";

const sessions: MultiplayerSession[] = [];
beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  sessions.splice(0).forEach((session) => session.dispose());
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function sessionFixture() {
  const lobby: LobbyState = {
    available: true,
    selfId: "guest",
    members: [],
    connected: [],
  };
  const library: SharedSaveLibrary = {
    cloudState: "disabled",
    slots: Array.from({ length: 4 }, (_, index) => ({
      id: `save-${index}`,
      name: `Grid ${index}`,
      updatedAt: 0,
      matchId: `match-${index}`,
      schema: 1,
      players: ["Host", "Guest"],
    })),
  };
  const bridge: DesktopBridge = {
    apiVersion: 1,
    getState: jest.fn(),
    setDisplay: jest.fn(),
    onStateChanged: jest.fn(),
    onGameFocusChanged: jest.fn(),
    onBeforeQuit: jest.fn(),
    readyToQuit: jest.fn(),
    quit: jest.fn(),
    readSaveLibrary: jest.fn(),
    writeSaveLibrary: jest.fn(),
    getLeaderboard: jest.fn(),
    submitScore: jest.fn(),
    openFriends: jest.fn(),
    multiplayerRequest: async (request) =>
      request.kind === "list-saves"
        ? library
        : request.kind === "join"
          ? { ...lobby, lobbyId: request.lobbyId, hostId: "host" }
          : lobby,
  };
  const session = new MultiplayerSession(bridge, jest.fn());
  sessions.push(session);
  await session.initialize();
  return { session, bridge };
}

async function showLobby() {
  const { session, bridge } = await sessionFixture();
  render(
    <Lobby
      session={session}
      onHosted={jest.fn()}
      onChooseNew={jest.fn()}
      onCopyCode={jest.fn()}
      onClose={jest.fn()}
      onLeave={jest.fn()}
    />,
  );
  return { session, bridge };
}

test("the lobby heading receives initial focus and focus on a new lobby mode", async () => {
  const { session } = await showLobby();
  const title = screen.getByRole("heading", { name: "Play with friends" });
  expect(screen.getByRole("dialog")).toHaveFocus();
  await act(async () => jest.advanceTimersByTime(1000));
  expect(title).toHaveFocus();
  await act(async () =>
    screen.getByRole("textbox", { name: "Invite code" }).focus(),
  );
  await act(async () => session.join("10977524123456789"));
  expect(screen.queryByRole("textbox", { name: "Invite code" })).toBeNull();
  expect(title).toHaveFocus();
});

test.each(["Invite code", "Host a game"])(
  "the lobby preserves focus on %s when navigation precedes the end of its opening animation",
  async (name) => {
    await showLobby();
    const control = screen.getByRole(
      name === "Invite code" ? "textbox" : "button",
      { name },
    );
    await act(async () => control.focus());
    expect(control).toHaveFocus();
    await act(async () => jest.advanceTimersByTime(1000));
    expect(control).toHaveFocus();
  },
);

test("returning from Mods cannot interrupt controller invite entry when both transitions finish", async () => {
  jest
    .spyOn(HTMLElement.prototype, "getClientRects")
    .mockReturnValue([{}] as unknown as DOMRectList);
  render(<button data-mods-trigger>Mods</button>);
  // Back schedules menu restoration before the player opens the real invitation dialog.
  restoreMenuFocus("[data-mods-trigger]");
  const { bridge } = await showLobby();
  const frame: DesktopInputFrame = { connected: true, actions: [], glyphs: {} };
  let input: (frame: DesktopInputFrame) => void = () => {};
  const showTextInput = jest.fn().mockResolvedValue({ status: "cancelled" });
  const stop = startDesktopInput(store, {
    ...bridge,
    setInputContext: async () => frame,
    onInput: (callback) => {
      input = callback;
      return () => {};
    },
    onGameFocusChanged: () => () => {},
    onBeforeQuit: () => () => {},
    showTextInput,
  });
  try {
    await act(async () => Promise.resolve());
    // Dialog container → Back → Host a game → Invite code, through the real controller.
    const down = () => input({ ...frame, actions: ["down"] });
    for (let step = 0; step < 3; step++) act(down);
    const code = screen.getByRole("textbox", { name: "Invite code" });
    expect(code).toHaveFocus();
    await act(async () => jest.advanceTimersByTime(1000));
    expect(code).toHaveFocus();
    await act(async () => input({ ...frame, actions: ["confirm"] }));
    expect(showTextInput).toHaveBeenCalledTimes(1);
    expect(showTextInput).toHaveBeenCalledWith(
      expect.objectContaining({ description: "Invite code" }),
    );
    expect(code).toHaveFocus();
  } finally {
    stop();
  }
});

async function showSaves() {
  const { session } = await sessionFixture();
  render(<SavesDialog session={session} onClose={jest.fn()} />);
  await act(async () => {
    await Promise.resolve();
  });
}

test("multiplayer saves focus the heading when the opening animation ends without navigation", async () => {
  await showSaves();
  await act(async () => jest.advanceTimersByTime(1000));
  expect(
    screen.getByRole("heading", { name: "Multiplayer saves" }),
  ).toHaveFocus();
});

test.each(["Search saves", "Back"])(
  "multiplayer saves preserve focus on %s when navigation precedes the end of the opening animation",
  async (name) => {
    await showSaves();
    const control = screen.getByRole(
      name === "Search saves" ? "textbox" : "button",
      { name },
    );
    await act(async () => control.focus());
    expect(control).toHaveFocus();
    await act(async () => jest.advanceTimersByTime(1000));
    expect(control).toHaveFocus();
  },
);
