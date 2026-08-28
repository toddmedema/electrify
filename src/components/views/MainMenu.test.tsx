import * as React from "react";
import { render, screen, within } from "@testing-library/react";
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
  it("shows a single, compact game subtitle", () => {
    render(<MainMenu {...props()} />);

    expect(
      screen.getByText(/Build power plants, keep the lights on/i),
    ).toHaveClass("gameSubtitle", "MuiTypography-body1");
    expect(screen.queryByText(/no energy or gaming experience/i)).toBeNull();
  });

  it("starts a new game from the primary guided-missions action", async () => {
    const onStart = jest.fn();
    render(<MainMenu {...props({ onStart })} />);

    await userEvent.click(
      screen.getByRole("button", { name: "Start guided missions" }),
    );
    expect(onStart).toHaveBeenCalled();
    expect(screen.queryByText("Continue")).not.toBeInTheDocument();
  });

  it("prioritizes continuing a save while offering mission selection", () => {
    render(<MainMenu {...props({ hasSavedGame: true })} />);

    expect(
      screen.getByRole("button", { name: "Continue your game" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Choose a mission" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Game resources" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Primary actions" })).toHaveStyle(
      { gap: "10px" },
    );
  });

  it("keeps sharing as a compact footer icon", () => {
    render(<MainMenu {...props()} />);

    expect(
      within(screen.getByRole("contentinfo")).getByRole("button", {
        name: "Share Electrify",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share game" })).toBeNull();
  });
});
