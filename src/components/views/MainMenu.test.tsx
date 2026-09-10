import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MainMenu, { Props } from "./MainMenu";

function props(overrides: Partial<Props> = {}): Props {
  return {
    audioEnabled: true,
    hasSavedGame: false,
    uid: "player",
    onAudioChange: jest.fn(),
    onContinue: jest.fn(),
    onSettings: jest.fn(),
    onManual: jest.fn(),
    onStart: jest.fn(),
    ...overrides,
  };
}

describe("MainMenu", () => {
  it("starts a new game from the primary play action", async () => {
    const onStart = jest.fn();
    const user = userEvent.setup();
    render(<MainMenu {...props({ onStart })} />);

    await user.click(screen.getByRole("button", { name: "Start playing" }));
    expect(onStart).toHaveBeenCalled();
    expect(screen.queryByText("Continue")).not.toBeInTheDocument();
  });

  it("prioritizes continuing a save while offering mission selection", () => {
    render(<MainMenu {...props({ hasSavedGame: true })} />);

    expect(
      screen.getByRole("button", { name: "Continue" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Start a new game" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Game resources" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Primary actions" })).toHaveStyle(
      { gap: "12px" },
    );
  });
});
