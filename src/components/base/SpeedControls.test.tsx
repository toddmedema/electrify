import { fireEvent, render, screen, within } from "@testing-library/react";
import {
  buildSpeedOptions,
  MultiplayerSpeedOptionsProps,
} from "./SpeedControls";

const multiplayer: MultiplayerSpeedOptionsProps = {
  selfId: "1",
  activeSpeed: "SLOW",
  players: [
    { id: "1", name: "Player 1", selectedSpeed: "ULTRA" },
    { id: "2", name: "Player 2", selectedSpeed: "NORMAL" },
    { id: "3", name: "Player 3", selectedSpeed: "SLOW" },
  ],
};

test("single-player keeps its four phone controls and selected clicks stay a no-op", () => {
  const onSpeedChange = jest.fn();
  render(buildSpeedOptions({ speed: "NORMAL", onSpeedChange, desktop: false }));
  const group = screen.getByRole("group", { name: "game speed" });
  expect(group).toBeVisible();
  expect(screen.getAllByRole("button")).toHaveLength(4);
  expect(
    screen.queryByRole("button", { name: "ultra speed" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "normal speed" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "normal speed" }));
  expect(onSpeedChange).not.toHaveBeenCalled();
  // Co-op's lifted label and marker row never reach the single-player control.
  expect(group.innerHTML).not.toMatch(/multiplayerSpeed/);
});

test("multiplayer adds only other players' icons along the bottom of the standard speed buttons", () => {
  const onSpeedChange = jest.fn();
  render(
    buildSpeedOptions({
      speed: "ULTRA",
      onSpeedChange,
      desktop: false,
      multiplayer,
    }),
  );
  const group = screen.getByRole("group", { name: "your game speed" });
  expect(screen.getAllByRole("button")).toHaveLength(5);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByText(/Game:.*Players/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "ultra speed" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.getByRole("button", { name: "slow speed" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  expect(
    screen.getByRole("button", { name: "ultra speed" }),
  ).not.toHaveAttribute("aria-current");
  expect(group).toHaveAccessibleDescription(
    /Game speed: 1×. Your selection: 24×/,
  );
  expect(group).toHaveAccessibleDescription(
    /Player 2 selected 3×. Player 3 selected 1×/,
  );
  expect(
    within(screen.getByRole("button", { name: "normal speed" })).getByTestId(
      "speed-peer-NORMAL-2",
    ),
  ).toBeInTheDocument();
  expect(
    within(screen.getByRole("button", { name: "slow speed" })).getByTestId(
      "speed-peer-SLOW-3",
    ),
  ).toBeInTheDocument();
  expect(screen.queryByTestId("speed-peer-ULTRA-1")).not.toBeInTheDocument();
  // Hovering a speed names who chose it.
  expect(screen.getByRole("button", { name: "normal speed" })).toHaveAttribute(
    "title",
    "3×: Player 2",
  );
  expect(screen.getByRole("button", { name: "fast speed" })).toHaveAttribute(
    "title",
    "12×: nobody",
  );
  fireEvent.click(screen.getByRole("button", { name: "ultra speed" }));
  expect(onSpeedChange).toHaveBeenCalledWith("ULTRA");
  fireEvent.click(screen.getByRole("button", { name: "normal speed" }));
  expect(onSpeedChange).toHaveBeenCalledWith("NORMAL");
});

test("temporary pauses keep chosen speeds and identify the cause without a status strip", () => {
  render(
    buildSpeedOptions({
      speed: "ULTRA",
      onSpeedChange: jest.fn(),
      desktop: true,
      multiplayer: {
        ...multiplayer,
        activeSpeed: "PAUSED",
        reason: "Player 2: Building capacity",
        players: multiplayer.players.map((player) =>
          player.id === "2"
            ? { ...player, pauseReason: "Building capacity" }
            : player,
        ),
      },
    }),
  );
  expect(screen.getByRole("button", { name: "ultra speed" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const group = screen.getByRole("group", { name: "your game speed" });
  expect(group).toHaveAttribute("data-active-speed", "PAUSED");
  expect(screen.getByRole("button", { name: "pause" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  expect(group).toHaveAccessibleDescription(
    /Game speed: Paused. Your selection: 24×/,
  );
  expect(group).toHaveAccessibleDescription(
    /Player 2 selected 3×; paused: Building capacity/,
  );
  expect(group).toHaveAttribute(
    "title",
    expect.stringContaining("Player 2: Building capacity"),
  );
  expect(
    within(screen.getByRole("button", { name: "pause" })).getByTestId(
      "speed-peer-PAUSED-2",
    ),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "pause" })).toHaveAttribute(
    "title",
    "Paused: Player 2: Building capacity",
  );
  expect(
    within(screen.getByRole("button", { name: "normal speed" })).queryByTestId(
      "speed-peer-NORMAL-2",
    ),
  ).not.toBeInTheDocument();
});

test("the active speed and your selection share one button when they agree", () => {
  render(
    buildSpeedOptions({
      speed: "NORMAL",
      onSpeedChange: jest.fn(),
      desktop: true,
      multiplayer: { ...multiplayer, activeSpeed: "NORMAL" },
    }),
  );
  const selected = screen.getByRole("button", { name: "normal speed" });
  expect(selected).toHaveAttribute("aria-current", "true");
  expect(selected).toHaveAttribute("aria-pressed", "true");
  expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(1);
  expect(screen.getAllByRole("button", { current: true })).toHaveLength(1);
});

test("other players' markers fill each button from the left, whatever their seat", () => {
  render(
    buildSpeedOptions({
      speed: "ULTRA",
      onSpeedChange: jest.fn(),
      desktop: true,
      multiplayer: {
        ...multiplayer,
        players: [
          { id: "1", name: "Player 1", selectedSpeed: "ULTRA" },
          { id: "2", name: "Player 2", selectedSpeed: "NORMAL" },
          { id: "3", name: "Player 3", selectedSpeed: "SLOW" },
          { id: "4", name: "Player 4", selectedSpeed: "SLOW" },
        ],
      },
    }),
  );
  // Seats 3 and 4 previously sat in the middle and right; they now start from the left.
  expect(screen.getByTestId("speed-peer-NORMAL-2")).toHaveAttribute(
    "data-slot",
    "0",
  );
  expect(screen.getByTestId("speed-peer-SLOW-3")).toHaveAttribute(
    "data-slot",
    "0",
  );
  expect(screen.getByTestId("speed-peer-SLOW-4")).toHaveAttribute(
    "data-slot",
    "1",
  );
});

test("unready players can reselect a running speed to resume without an extra control", () => {
  const onSpeedChange = jest.fn();
  const props = {
    speed: "ULTRA" as const,
    onSpeedChange,
    desktop: true,
    multiplayer: {
      ...multiplayer,
      activeSpeed: "PAUSED" as const,
      readyRequired: true,
    },
  };
  const { rerender } = render(buildSpeedOptions(props));
  expect(
    screen.getByRole("group", { name: "your game speed" }),
  ).toHaveAccessibleDescription(/Select a speed to resume/);
  fireEvent.click(screen.getByRole("button", { name: "ultra speed" }));
  expect(onSpeedChange).toHaveBeenCalledWith("ULTRA");
  onSpeedChange.mockClear();
  rerender(
    buildSpeedOptions({
      ...props,
      multiplayer: { ...props.multiplayer, ready: true },
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "ultra speed" }));
  expect(onSpeedChange).toHaveBeenCalledWith("ULTRA");
  expect(screen.getAllByRole("button")).toHaveLength(5);
});

test("reselecting pause sends only a pause, even when readiness is required", () => {
  const onSpeedChange = jest.fn();
  render(
    buildSpeedOptions({
      speed: "PAUSED",
      onSpeedChange,
      desktop: true,
      multiplayer: {
        ...multiplayer,
        activeSpeed: "PAUSED",
        readyRequired: true,
      },
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "pause" }));
  expect(onSpeedChange.mock.calls).toEqual([["PAUSED"]]);
});

test("a multiplayer speed reversal is sent before the host acknowledges the first choice", () => {
  const onSpeedChange = jest.fn();
  render(
    buildSpeedOptions({
      speed: "SLOW",
      onSpeedChange,
      desktop: true,
      multiplayer,
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "normal speed" }));
  // The controls still reflect the host's previous snapshot while NORMAL is in flight.
  fireEvent.click(screen.getByRole("button", { name: "slow speed" }));
  expect(onSpeedChange.mock.calls).toEqual([["NORMAL"], ["SLOW"]]);
});

const thumbVars = (group: HTMLElement) => ({
  index: group.style.getPropertyValue("--speed-index"),
  count: group.style.getPropertyValue("--speed-count"),
});

test("single-player's thumb sits under the selected speed and follows it", () => {
  const { rerender } = render(
    buildSpeedOptions({
      speed: "NORMAL",
      onSpeedChange: jest.fn(),
      desktop: true,
    }),
  );
  const group = screen.getByRole("group", { name: "game speed" });
  // Pause, 1×, 3×, 12×, 24×: 3× is the third segment.
  expect(thumbVars(group)).toEqual({ index: "2", count: "5" });
  expect(screen.getByRole("button", { name: "normal speed" })).toHaveAttribute(
    "data-thumb",
    "true",
  );
  expect(
    within(group)
      .getAllByRole("button")
      .filter((button) => button.hasAttribute("data-thumb")),
  ).toHaveLength(1);
  rerender(
    buildSpeedOptions({
      speed: "PAUSED",
      onSpeedChange: jest.fn(),
      desktop: true,
    }),
  );
  expect(thumbVars(group).index).toBe("0");
  expect(screen.getByRole("button", { name: "pause" })).toHaveAttribute(
    "data-thumb",
    "true",
  );
});

test("a speed the layout does not offer leaves the thumb hidden, not on the wrong segment", () => {
  render(
    buildSpeedOptions({
      speed: "ULTRA",
      onSpeedChange: jest.fn(),
      desktop: false,
    }),
  );
  const group = screen.getByRole("group", { name: "game speed" });
  expect(group).toHaveAttribute("data-no-thumb", "true");
  expect(
    within(group)
      .getAllByRole("button")
      .some((button) => button.hasAttribute("data-thumb")),
  ).toBe(false);
});

test("the co-op thumb follows the clock while the pressed state follows your request", () => {
  render(
    buildSpeedOptions({
      speed: "ULTRA",
      onSpeedChange: jest.fn(),
      desktop: false,
      multiplayer,
    }),
  );
  const group = screen.getByRole("group", { name: "your game speed" });
  // The clock runs at 1×, so the thumb is under the second segment, not your 24×.
  expect(thumbVars(group)).toEqual({ index: "1", count: "5" });
  expect(screen.getByRole("button", { name: "slow speed" })).toHaveAttribute(
    "data-thumb",
    "true",
  );
  expect(
    screen.getByRole("button", { name: "ultra speed" }),
  ).not.toHaveAttribute("data-thumb");
  expect(screen.getByRole("button", { name: "ultra speed" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("a pause moves the co-op thumb to Pause without moving your pressed selection", () => {
  render(
    buildSpeedOptions({
      speed: "ULTRA",
      onSpeedChange: jest.fn(),
      desktop: true,
      multiplayer: {
        ...multiplayer,
        activeSpeed: "PAUSED",
        reason: "Player 2: Building capacity",
      },
    }),
  );
  expect(
    thumbVars(screen.getByRole("group", { name: "your game speed" })).index,
  ).toBe("0");
  expect(screen.getByRole("button", { name: "pause" })).toHaveAttribute(
    "data-thumb",
    "true",
  );
  expect(screen.getByRole("button", { name: "ultra speed" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("peer pips stay centred whatever the count, in the order players took their slots", () => {
  render(
    buildSpeedOptions({
      speed: "ULTRA",
      onSpeedChange: jest.fn(),
      desktop: true,
      multiplayer: {
        ...multiplayer,
        players: [
          { id: "1", name: "Player 1", selectedSpeed: "ULTRA" },
          { id: "2", name: "Player 2", selectedSpeed: "SLOW" },
          { id: "3", name: "Player 3", selectedSpeed: "SLOW" },
          { id: "4", name: "Player 4", selectedSpeed: "SLOW" },
        ],
      },
    }),
  );
  const pips = ["2", "3", "4"].map((id) =>
    screen.getByTestId(`speed-peer-SLOW-${id}`),
  );
  // Centring is the stylesheet's job; each pip says its slot and how many share the segment.
  expect(pips.map((pip) => pip.style.getPropertyValue("--slot"))).toEqual([
    "0",
    "1",
    "2",
  ]);
  for (const pip of pips)
    expect(pip.style.getPropertyValue("--peers")).toBe("3");
});

test("waiting to resume marks the group, and confirming a speed clears it", () => {
  const props = {
    speed: "ULTRA" as const,
    onSpeedChange: jest.fn(),
    desktop: true,
    multiplayer: {
      ...multiplayer,
      activeSpeed: "PAUSED" as const,
      readyRequired: true,
    },
  };
  const { rerender } = render(buildSpeedOptions(props));
  const group = screen.getByRole("group", { name: "your game speed" });
  expect(group).toHaveAttribute("data-resume", "true");
  // Your request stays on the button you picked: the dashed ring, not a moved selection.
  expect(screen.getByRole("button", { name: "ultra speed" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  rerender(
    buildSpeedOptions({
      ...props,
      multiplayer: { ...props.multiplayer, ready: true },
    }),
  );
  expect(group).not.toHaveAttribute("data-resume");
  // Single-player never waits on anyone.
  rerender(
    buildSpeedOptions({
      speed: "NORMAL",
      onSpeedChange: jest.fn(),
      desktop: true,
    }),
  );
  expect(screen.getByRole("group", { name: "game speed" })).not.toHaveAttribute(
    "data-resume",
  );
});

test("a status region speaks pauses and the resume prompt, never a plain running clock", () => {
  const base = {
    speed: "ULTRA" as const,
    onSpeedChange: jest.fn(),
    desktop: true,
  };
  const { rerender } = render(buildSpeedOptions({ ...base, multiplayer }));
  expect(screen.getByRole("status")).toBeEmptyDOMElement();
  rerender(
    buildSpeedOptions({
      ...base,
      multiplayer: {
        ...multiplayer,
        activeSpeed: "PAUSED",
        reason: "Player 2: Building capacity",
      },
    }),
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "Game paused: Player 2: Building capacity.",
  );
  rerender(
    buildSpeedOptions({
      ...base,
      multiplayer: {
        ...multiplayer,
        activeSpeed: "PAUSED",
        readyRequired: true,
      },
    }),
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "Select a speed to resume.",
  );
  // Single-player has no shared clock to announce.
  rerender(buildSpeedOptions({ ...base }));
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

test("a disabled group says so for styling without losing its thumb", () => {
  render(
    buildSpeedOptions({
      speed: "SLOW",
      onSpeedChange: jest.fn(),
      desktop: true,
      disabled: true,
      multiplayer,
    }),
  );
  expect(
    screen.getByRole("group", { name: "your game speed" }),
  ).toHaveAttribute("data-disabled", "true");
  expect(
    screen
      .getAllByRole("button")
      .every((button) => button.hasAttribute("disabled")),
  ).toBe(true);
});
