import { act, fireEvent, render, screen } from "@testing-library/react";
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
