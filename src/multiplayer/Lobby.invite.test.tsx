import { act, fireEvent, render, screen } from "@testing-library/react";
import { CrossplayApiError } from "./CrossplayApi";
import type { MultiplayerSession } from "./Session";
import Lobby from "./Lobby";

test("a replaced invite is not submitted by a join that is still authorizing", async () => {
  let release!: () => void;
  const authorizing = new Promise<void>((resolve) => {
    release = resolve;
  });
  const join = jest.fn(async () => undefined);
  const snapshot = {
    lobby: { available: true, members: [], connected: [] },
    pending: false,
    busy: false,
    waitingForHost: false,
    loadingSaves: false,
  };
  const session = {
    onlineCampaigns: true,
    subscribe: () => () => undefined,
    getSnapshot: () => snapshot,
    join,
  } as unknown as MultiplayerSession;
  const props = {
    session,
    onChooseNew: jest.fn(),
    onCopyCode: jest.fn(),
    onClose: jest.fn(),
    onLeave: jest.fn(),
    onAuthorize: () => authorizing,
    onJoined: jest.fn(),
    initialInviteCode: "abc123",
  };
  const view = render(<Lobby {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Join" }));
  view.rerender(<Lobby {...props} initialInviteCode="xyz789" />);
  await act(async () => {
    release();
    await authorizing;
  });
  expect(join).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Join" })).toBeEnabled();
});

test("resume and relay failures are explained without the service code", async () => {
  const join = jest.fn(async () => {
    throw new CrossplayApiError("roster_unavailable");
  });
  const snapshot = {
    lobby: { available: true, members: [], connected: [] },
    pending: false,
    busy: false,
    waitingForHost: false,
    loadingSaves: false,
  };
  const session = {
    onlineCampaigns: true,
    subscribe: () => () => undefined,
    getSnapshot: () => snapshot,
    join,
  } as unknown as MultiplayerSession;
  render(
    <Lobby
      session={session}
      onChooseNew={jest.fn()}
      onCopyCode={jest.fn()}
      onClose={jest.fn()}
      onLeave={jest.fn()}
      onJoined={jest.fn()}
      initialInviteCode="abc123"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Join" }));
  expect(
    await screen.findByText(
      "The original players are no longer all available, so this campaign cannot resume.",
    ),
  ).toBeInTheDocument();
  expect(screen.queryByText("roster_unavailable")).not.toBeInTheDocument();
});

test("resuming a campaign explains a service failure without the code", async () => {
  const start = jest.fn(async () => {
    throw new CrossplayApiError("incompatible");
  });
  const snapshot = {
    lobby: {
      available: true,
      lobbyId: "room",
      selfId: "host",
      hostId: "host",
      members: [{ id: "host", name: "Ada", slot: "save:host" }],
      connected: ["host"],
    },
    pendingCampaign: {
      id: "save",
      name: "Grid",
      players: [
        { id: "host", name: "Ada" },
        { id: "guest", name: "Bea" },
      ],
      requiredPlayerIds: ["host"],
    },
    pending: false,
    busy: false,
    waitingForHost: false,
    loadingSaves: false,
  };
  const session = {
    onlineCampaigns: true,
    subscribe: () => () => undefined,
    getSnapshot: () => snapshot,
    resumeBlocker: () => undefined,
    dismissError: () => undefined,
    start,
  } as unknown as MultiplayerSession;
  render(
    <Lobby
      session={session}
      onChooseNew={jest.fn()}
      onCopyCode={jest.fn()}
      onClose={jest.fn()}
      onLeave={jest.fn()}
      onJoined={jest.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Resume game" }));
  expect(
    await screen.findByText(
      "This campaign cannot resume on this version of Electrify.",
    ),
  ).toBeInTheDocument();
  expect(screen.queryByText("incompatible")).not.toBeInTheDocument();
});
