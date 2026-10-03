import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MainMenu, { Props } from "./MainMenu";

function props(overrides: Partial<Props> = {}): Props {
  return {
    audioEnabled: true,
    hasSavedGame: false,
    hasSavedGames: false,
    onAudioChange: jest.fn(),
    onContinue: jest.fn(),
    onSavedGames: jest.fn(),
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
    expect(
      screen.queryByRole("button", { name: "Saved games" }),
    ).not.toBeInTheDocument();
  });

  it("prioritizes continuing a save while offering mission selection", () => {
    render(
      <MainMenu {...props({ hasSavedGame: true, hasSavedGames: true })} />,
    );

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
      { gap: "8px" },
    );
    const buttons = within(
      screen.getByRole("region", { name: "Primary actions" }),
    ).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual([
      "Continue",
      "Start a new game",
      "Saved games",
    ]);
    expect(buttons[1]).toHaveClass("MuiButton-outlined");
    expect(buttons[2]).toHaveClass("MuiButton-outlined");
  });

  it("identifies Continue's target and keeps the library accessible", async () => {
    const onSavedGames = jest.fn();
    render(
      <MainMenu
        {...props({
          hasSavedGame: true,
          hasSavedGames: true,
          savedGameName: "Wind experiment",
          savedGameDescription: "Rise of Renewables · June 2035",
          onSavedGames,
        })}
      />,
    );
    expect(screen.getByText("Wind experiment")).toBeInTheDocument();
    expect(
      screen.getByText("Rise of Renewables · June 2035"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Saved games" }));
    expect(onSavedGames).toHaveBeenCalledTimes(1);
  });

  it("offers the library when only finished, unplayable saves exist", () => {
    render(<MainMenu {...props({ hasSavedGames: true })} />);
    expect(
      screen.getByRole("button", { name: "Saved games" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start playing" })).toHaveClass(
      "MuiButton-contained",
    );
    expect(
      screen.queryByRole("button", { name: "Continue" }),
    ).not.toBeInTheDocument();
  });

  it("links to Discord first in the footer", () => {
    render(<MainMenu {...props()} />);

    const discord = screen.getByRole("link", {
      name: "Join the Electrify Discord",
    });
    expect(discord).toHaveAttribute("href", "https://discord.gg/Chrjk36DC");
    expect(
      screen.getAllByRole("link", {
        name: /Discord|feedback|About|Privacy/,
      })[0],
    ).toBe(discord);
  });
});
