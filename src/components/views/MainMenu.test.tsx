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
  it("explains the game without specialist language", () => {
    render(<MainMenu {...props()} />);

    expect(
      screen.getByText(/Keep the lights on. Build a cleaner grid/i),
    ).toHaveClass("gameSubtitle", "MuiTypography-body1");
    expect(screen.queryByText(/no energy or gaming experience/i)).toBeNull();
  });

  it("starts a new game from the primary play action", async () => {
    const onStart = jest.fn();
    const user = userEvent.setup();
    render(<MainMenu {...props({ onStart })} />);

    await user.click(screen.getByRole("button", { name: "Start playing" }));
    expect(onStart).toHaveBeenCalled();
    expect(screen.queryByText("Continue")).not.toBeInTheDocument();
  });

  it("only advertises account-free play before sign-in", () => {
    const { rerender } = render(<MainMenu {...props({ uid: undefined })} />);
    const accountActions = screen.getByRole("region", {
      name: "Account actions",
    });
    expect(
      within(accountActions).getByRole("button", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(
      within(accountActions).getByText("Free · no sign-up needed"),
    ).toBeInTheDocument();

    rerender(<MainMenu {...props({ uid: "player" })} />);
    expect(
      screen.queryByText("Free · no sign-up needed"),
    ).not.toBeInTheDocument();
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
      { gap: "10px" },
    );
  });

  it("groups secondary actions into compact rows", () => {
    render(
      <MainMenu
        {...props({
          audioEnabled: undefined,
          hasSavedGame: true,
          uid: undefined,
        })}
      />,
    );

    const primary = screen.getByRole("region", { name: "Primary actions" });
    const resources = screen.getByRole("navigation", {
      name: "Game resources",
    });
    const discovery = screen.getByRole("region", {
      name: "Discovery actions",
    });

    expect(primary).toHaveStyle({ flexDirection: "column" });
    expect(resources).toHaveStyle({ flexDirection: "row", gap: "6px" });
    expect(
      within(resources).queryByRole("button", { name: "Sign in" }),
    ).not.toBeInTheDocument();
    expect(discovery).toHaveStyle({ flexDirection: "row", gap: "6px" });
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

  it("opens the embedded feedback form without exposing an email address", () => {
    render(<MainMenu {...props()} />);

    expect(screen.getByRole("link", { name: "Send feedback" })).toHaveAttribute(
      "href",
      "/about.html#feedback",
    );
  });
});
