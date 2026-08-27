import * as React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { createGame } from "../../testing/Simulator";
import { GameAppBar, Props } from "./GameAppBar";

jest.mock("../../Globals", () => ({
  ...jest.requireActual("../../Globals"),
  isBigScreen: () => false,
  isSmallScreen: () => true,
}));

function renderAppBar(overrides: Partial<Props> = {}) {
  const game = createGame({ scenarioId: 101 });
  const props: Props = {
    game: { ...game, inGame: true },
    audioEnabled: true,
    onAudioChange: () => undefined,
    onEvents: () => undefined,
    onManual: () => undefined,
    onNextTutorial: () => undefined,
    onQuit: () => undefined,
    onSettings: () => undefined,
    onSpeedChange: () => undefined,
    ...overrides,
  };
  return render(<GameAppBar {...props} />);
}

describe("GameAppBar mobile speed controls", () => {
  it("keeps all four speeds one tap away", () => {
    const onSpeedChange = jest.fn();
    renderAppBar({ onSpeedChange });

    const speedControls = screen.getByRole("group", { name: "game speed" });
    expect(within(speedControls).getAllByRole("button")).toHaveLength(4);

    fireEvent.click(
      within(speedControls).getByRole("button", { name: "fast speed" }),
    );
    expect(onSpeedChange).toHaveBeenCalledWith("FAST");
  });

  it("omits the redundant money and time icons", () => {
    renderAppBar();
    expect(screen.queryByLabelText("Money")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Time")).not.toBeInTheDocument();
  });
});
