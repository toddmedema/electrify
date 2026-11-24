import { fireEvent, render, screen, within } from "@testing-library/react";
import { SCENARIOS, TUTORIALS } from "../../data/Scenarios";
import { registerCoopControls } from "../../multiplayer/Registry";
import NewGame from "../views/NewGame";
import CoopBrowseBar, { CoopStartButton } from "./CoopBrowseBar";
import type { CoopSelectionType, GameType } from "../../Types";

const coop = (update: Partial<CoopSelectionType> = {}): CoopSelectionType => ({
  role: "guest",
  hostName: "Alice",
  players: [
    { id: "a", name: "Alice", host: true, connected: true, ready: false },
    { id: "b", name: "Bob", host: false, connected: true, ready: true },
    { id: "c", name: "Cleo", host: false, connected: false, ready: false },
  ],
  ready: false,
  starting: false,
  ...update,
});
const controls = {
  start: jest.fn(),
  ready: jest.fn(),
  back: jest.fn(),
  copyCode: jest.fn(),
  openSaves: jest.fn(),
  kick: jest.fn(),
};
beforeEach(() => {
  jest.clearAllMocks();
  registerCoopControls(controls);
});
afterAll(() => registerCoopControls(undefined));

test("guests see who they follow and every player's state as a named icon", () => {
  render(<CoopBrowseBar coop={coop()} />);
  expect(screen.getByText("Following Alice")).toBeInTheDocument();
  const roster = screen.getByLabelText("Players");
  expect(
    within(roster).getByText("Connecting", { selector: "span" }),
  ).toBeVisible();
  expect(within(roster).getByRole("img", { name: "Host" })).toBeInTheDocument();
  expect(
    within(roster).getByRole("img", { name: "Ready" }),
  ).toBeInTheDocument();
  expect(
    within(roster).getByRole("img", { name: "Connecting" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("Invite via Steam")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Leave" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Manage lobby" }),
  ).not.toBeInTheDocument();
});

test("a host alone invites friends first, can copy the code and cannot start yet", () => {
  const host = coop({
    role: "host",
    inviteCode: "012345",
    hasSaves: true,
    players: [coop().players[0]],
  });
  render(
    <>
      <CoopBrowseBar coop={host} offerSaves />
      <CoopStartButton coop={host} onStart={jest.fn()} />
    </>,
  );
  expect(screen.queryByText(/Invite friends to play|can join/)).toBeNull();
  expect(screen.getByText("012345")).toBeVisible();
  const copy = screen.getByRole("button", { name: "Copy code" });
  expect(copy).toHaveClass("MuiButton-contained");
  fireEvent.click(copy);
  expect(controls.copyCode).toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: /invite.*steam/i }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Load multiplayer save" }),
  );
  expect(controls.openSaves).toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "Invite a friend to start" }),
  ).toBeDisabled();
});

test("saves are offered only where the host chooses a new game", () => {
  render(<CoopBrowseBar coop={coop({ role: "host", hasSaves: true })} />);
  expect(screen.queryByText("Load multiplayer save")).not.toBeInTheDocument();
});

test("the host sees how many guests are ready and waits for the rest", () => {
  const onStart = jest.fn();
  const host = coop({
    role: "host",
    inviteCode: "012345",
    players: coop().players.map((p) => ({ ...p, connected: true })),
  });
  render(
    <>
      <CoopBrowseBar coop={host} />
      <CoopStartButton coop={host} onStart={onStart} />
    </>,
  );
  expect(screen.queryByText(/choosing for/)).toBeNull();
  // The count supplements the individual readiness labels for screen readers.
  expect(screen.getByText("1 of 2 ready")).toHaveClass("srOnly");
  expect(screen.getAllByRole("img", { name: "Reviewing" })).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Copy code" })).toHaveClass(
    "MuiButton-outlined",
  );
  expect(
    screen.getByRole("button", { name: "Waiting for players" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Waiting for players" }));
  expect(onStart).not.toHaveBeenCalled();
});

test("the host kicks a guest from the name chip after it offers Kick?", () => {
  const host = coop({
    role: "host",
    players: coop().players.map((player) => ({ ...player, connected: true })),
  });
  render(<CoopBrowseBar coop={host} />);
  const cleo = screen.getByRole("button", { name: "Kick Cleo" });
  expect(cleo).toHaveTextContent("Reviewing");
  expect(cleo).not.toHaveTextContent("Kick?");
  fireEvent.mouseEnter(cleo);
  expect(cleo).toHaveTextContent("Kick?");
  expect(cleo).not.toHaveTextContent("Reviewing");
  fireEvent.click(cleo);
  expect(controls.kick).toHaveBeenCalledWith("c");
  expect(screen.queryByRole("button", { name: "Kick Alice" })).toBeNull();
});

test("an online host waits until every guest is ready", () => {
  const onStart = jest.fn();
  const players = coop().players.map((player) => ({
    ...player,
    connected: true,
  }));
  const { rerender } = render(
    <CoopStartButton
      coop={coop({ role: "host", inviteCode: "012345", players })}
      onStart={onStart}
    />,
  );
  const waiting = screen.getByRole("button", { name: "Waiting for players" });
  expect(waiting).toBeDisabled();
  fireEvent.click(waiting);
  expect(onStart).not.toHaveBeenCalled();
  rerender(
    <CoopStartButton
      coop={coop({
        role: "host",
        inviteCode: "012345",
        players: players.map((player) => ({ ...player, ready: true })),
      })}
      onStart={onStart}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Start for everyone" }));
  expect(onStart).toHaveBeenCalledTimes(1);
});

test("a guest's one action marks Ready for the selection on screen, then clears it", () => {
  const onStart = jest.fn();
  const { rerender } = render(
    <CoopStartButton coop={coop()} onStart={onStart} />,
  );
  fireEvent.click(screen.getByText("I'm ready"));
  expect(controls.ready).toHaveBeenCalledWith(true);
  rerender(<CoopStartButton coop={coop({ ready: true })} onStart={onStart} />);
  const ready = screen.getByRole("button");
  expect(ready).toHaveTextContent("Ready");
  expect(ready).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(ready);
  expect(controls.ready).toHaveBeenCalledWith(false);
  expect(onStart).not.toHaveBeenCalled();
});

test("choosing together drops the lessons and the personal recommendations", () => {
  render(
    <NewGame
      game={{} as GameType}
      coop={coop()}
      onBack={jest.fn()}
      onCustomGame={jest.fn()}
      onDetails={jest.fn()}
      onTutorial={jest.fn()}
    />,
  );
  expect(screen.getByText("Choose a game together")).toBeInTheDocument();
  expect(screen.queryByText("Learn the basics")).not.toBeInTheDocument();
  expect(screen.queryByText("For you")).not.toBeInTheDocument();
  expect(
    within(screen.getByTestId("challenge-list")).getAllByTestId(
      /^mission-row-/,
    ),
  ).toHaveLength(SCENARIOS.length - TUTORIALS.length);
  // A guest's rows show the catalog without pretending to open anything.
  expect(
    within(screen.getByTestId("challenge-list")).queryAllByRole("button"),
  ).toHaveLength(0);
});

test("guests hear what the host has open as it changes", () => {
  const { rerender } = render(<CoopBrowseBar coop={coop()} />);
  const status = screen.getByRole("status");
  expect(status).toHaveTextContent("Choosing a game…");
  rerender(<CoopBrowseBar coop={coop({ viewing: "Deep Freeze on Hard" })} />);
  expect(status).toHaveTextContent("Following Alice");
  expect(status).toHaveTextContent("Deep Freeze on Hard");
});

test("a setup that can't be played can't be started or marked ready", () => {
  const players = coop().players.map((player) => ({
    ...player,
    connected: true,
    ready: !player.host,
  }));
  render(
    <>
      <CoopStartButton
        coop={coop({ role: "host", players })}
        onStart={jest.fn()}
        disabled
      />
      <CoopStartButton coop={coop()} onStart={jest.fn()} disabled />
    </>,
  );
  const [start, ready] = screen.getAllByRole("button");
  expect(start).toHaveTextContent("Start for everyone");
  expect(start).toBeDisabled();
  expect(ready).toHaveTextContent("I'm ready");
  expect(ready).toBeDisabled();
});
