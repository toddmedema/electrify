import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DesktopBridge } from "../Desktop";
import type { LobbyState, SharedSaveLibrary } from "./Native";
import { MultiplayerSession } from "./Session";
import { steamSessionServices } from "./SteamSessionServices";
import SavesDialog from "./SavesDialog";

const sessions: MultiplayerSession[] = [];
afterEach(() => sessions.splice(0).forEach((session) => session.dispose()));

const slot = (id: string, players: string[]) => ({
  id,
  name: "Custom Game",
  updatedAt: Date.UTC(2026, 10, 1),
  matchId: `match-${id}`,
  schema: 1,
  players,
});

async function showSaves() {
  let library: SharedSaveLibrary = {
    cloudState: "disabled",
    slots: [slot("a", ["Ada", "Grace"]), slot("b", ["Hedy"])],
  };
  const lobby: LobbyState = {
    available: true,
    selfId: "host",
    hostId: "host",
    lobbyId: "lobby",
    members: [],
    connected: [],
  };
  const requests: unknown[] = [];
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
    multiplayerRequest: async (request) => {
      requests.push(request);
      if (request.kind === "delete-save")
        library = {
          ...library,
          slots: library.slots.filter(({ id }) => id !== request.id),
        };
      return request.kind === "list-saves" || request.kind === "delete-save"
        ? library
        : lobby;
    },
  };
  const session = new MultiplayerSession(
    steamSessionServices(bridge),
    jest.fn(),
    jest.fn(),
  );
  sessions.push(session);
  await session.initialize();
  render(<SavesDialog session={session} onClose={jest.fn()} />);
  await act(async () => {
    await Promise.resolve();
  });
  return { requests };
}

test("each save is named for its players and offers a plain Load", async () => {
  await showSaves();
  const dialog = screen.getByRole("dialog", { name: "Multiplayer saves" });
  expect(
    within(dialog).getByRole("heading", { name: "Ada, Grace" }),
  ).toBeInTheDocument();
  expect(
    within(dialog).getByRole("heading", { name: "Hedy" }),
  ).toBeInTheDocument();
  // Every multiplayer save is the same scenario, so its name says nothing.
  expect(within(dialog).queryByText("Custom Game")).not.toBeInTheDocument();
  expect(within(dialog).getAllByRole("button", { name: "Load" })).toHaveLength(
    2,
  );
  expect(
    within(dialog).queryByRole("button", { name: "Load save" }),
  ).not.toBeInTheDocument();
});

test("Delete removes a save at once, without exporting or asking again", async () => {
  const user = userEvent.setup();
  const { requests } = await showSaves();
  await user.click(
    screen.getByRole("button", { name: "Actions for Ada, Grace" }),
  );
  const items = screen.getAllByRole("menuitem");
  expect(items.map((item) => item.textContent)).toEqual(["Delete"]);
  await user.click(items[0]);
  expect(requests).toContainEqual({ kind: "delete-save", id: "a" });
  expect(
    screen.queryByRole("heading", { name: "Ada, Grace" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Hedy" })).toBeInTheDocument();
  // Nothing else asks the player to confirm or explain.
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
});
