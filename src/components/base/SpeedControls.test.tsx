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
  fireEvent.click(screen.getByRole("button", { name: "ultra speed" }));
  expect(onSpeedChange).not.toHaveBeenCalled();
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
  expect(
    within(screen.getByRole("button", { name: "normal speed" })).getByTestId(
      "speed-peer-NORMAL-2",
    ),
  ).toBeInTheDocument();
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
  expect(onSpeedChange).not.toHaveBeenCalled();
  expect(screen.getAllByRole("button")).toHaveLength(5);
});

test("reselecting pause never signals readiness", () => {
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
  expect(onSpeedChange).not.toHaveBeenCalled();
});
