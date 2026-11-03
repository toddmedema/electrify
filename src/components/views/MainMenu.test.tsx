import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MainMenu, { Props } from "./MainMenu";
import type { DesktopBridge, DesktopState } from "../../Desktop";

function desktopBridge(available = false): DesktopBridge {
  const state: DesktopState = {
    display: { fullscreen: false, width: 1280, height: 800, resolutions: [] },
    steam: { available, online: available, cloudEnabled: false },
  };
  return {
    apiVersion: 1,
    getState: jest.fn(async () => state),
    onStateChanged: () => () => {},
    setDisplay: async () => state.display,
    onGameFocusChanged: () => () => {},
    quit: async () => {},
    onBeforeQuit: () => () => {},
    readyToQuit: () => {},
    readSaveLibrary: async () => ({
      local: null,
      cloud: null,
      cloudState: "disabled",
    }),
    writeSaveLibrary: async () => ({ cloudState: "disabled" }),
    getLeaderboard: async () => [],
    submitScore: async () => {},
    openFriends: async () => {},
  };
}

function props(overrides: Partial<Props> = {}): Props {
  return {
    audioEnabled: true,
    hasSavedGame: false,
    hasSavedGames: false,
    onAudioChange: jest.fn(),
    onContinue: jest.fn(),
    onSavedGames: jest.fn(),
    onSettings: jest.fn(),
    onMods: jest.fn(),
    onAchievements: jest.fn(),
    onManual: jest.fn(),
    onStart: jest.fn(),
    ...overrides,
  };
}

describe("MainMenu", () => {
  afterEach(() => {
    delete window.electrifyDesktop;
    jest.restoreAllMocks();
  });

  it("keeps the first-run sound prompt in the browser", () => {
    render(<MainMenu {...props({ audioEnabled: undefined })} />);
    expect(screen.getByRole("button", { name: "Turn on sound" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Mods" })).toBeNull();
  });

  it("opens mods just above Settings when the desktop bridge supports them, including offline", async () => {
    window.electrifyDesktop = {
      ...desktopBridge(),
      mods: async () => ({ entries: [] }),
    };
    const onMods = jest.fn();
    render(<MainMenu {...props({ onMods })} />);
    const resources = within(
      screen.getByRole("navigation", { name: "Game resources" }),
    );
    const buttons = resources.getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual([
      "Manual",
      "Mods",
      "Settings",
      "Quit",
    ]);
    expect(resources.getByRole("button", { name: "Mods" })).toHaveClass(
      "MuiButton-text",
    );
    await userEvent.click(resources.getByRole("button", { name: "Mods" }));
    expect(onMods).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, false, true])(
    "never offers Turn on sound in Electron when the preference is %s",
    async (audioEnabled) => {
      window.electrifyDesktop = desktopBridge();
      render(<MainMenu {...props({ audioEnabled })} />);
      expect(
        screen.queryByRole("button", { name: "Turn on sound" }),
      ).not.toBeInTheDocument();
    },
  );
  it("offers the gallery before Manual in the browser", async () => {
    const onAchievements = jest.fn();
    render(<MainMenu {...props({ onAchievements })} />);
    expect(
      within(screen.getByRole("navigation", { name: "Game resources" }))
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Achievements", "Manual", "Settings"]);
    await userEvent.click(screen.getByRole("button", { name: "Achievements" }));
    expect(onAchievements).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])(
    "leaves achievements to Steam from the first render, with Steam available: %s",
    async (available) => {
      window.electrifyDesktop = desktopBridge(available);
      render(<MainMenu {...props()} />);
      expect(
        screen.queryByRole("button", { name: "Achievements" }),
      ).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Manual" }));
      expect(
        screen.queryByRole("button", { name: "Achievements" }),
      ).not.toBeInTheDocument();
    },
  );
  it("starts a new game from the primary play action", async () => {
    const onStart = jest.fn();
    const user = userEvent.setup();
    render(<MainMenu {...props({ onStart })} />);

    await user.click(screen.getByRole("button", { name: "Play" }));
    expect(onStart).toHaveBeenCalled();
    expect(screen.queryByText("Continue")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Saved games" }),
    ).not.toBeInTheDocument();
  });

  it("prioritizes continuing a save while offering mission selection and the save library", async () => {
    const onSavedGames = jest.fn();
    render(
      <MainMenu
        {...props({ hasSavedGame: true, hasSavedGames: true, onSavedGames })}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Continue" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New game" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Game resources" }),
    ).toBeInTheDocument();
    const buttons = within(
      screen.getByRole("region", { name: "Primary actions" }),
    ).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual([
      "Continue",
      "New game",
      "Saved games",
    ]);
    await userEvent.click(screen.getByRole("button", { name: "Saved games" }));
    expect(onSavedGames).toHaveBeenCalledTimes(1);
  });

  it("offers the library when only finished, unplayable saves exist", () => {
    render(<MainMenu {...props({ hasSavedGames: true })} />);
    expect(
      screen.getByRole("button", { name: "Saved games" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play" })).toHaveClass(
      "MuiButton-text",
    );
    expect(
      screen.queryByRole("button", { name: "Continue" }),
    ).not.toBeInTheDocument();
  });

  it("moves the active button to a hovered control and continues keyboard navigation from there", async () => {
    // jsdom reports no layout, so give the menu's controls a rect for useMenuKeys to see.
    const clientRects = jest
      .spyOn(HTMLElement.prototype, "getClientRects")
      .mockReturnValue([{}] as unknown as DOMRectList);
    const user = userEvent.setup();
    render(<MainMenu {...props()} />);
    expect(screen.getByRole("button", { name: "Play" })).toHaveFocus();
    await user.hover(screen.getByRole("button", { name: "Manual" }));
    expect(screen.getByRole("button", { name: "Manual" })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("button", { name: "Achievements" })).toHaveFocus();
    clientRects.mockRestore();
  });

  it("keeps keyboard focus when layout moves a control under a stationary pointer", async () => {
    const clientRects = jest
      .spyOn(HTMLElement.prototype, "getClientRects")
      .mockReturnValue([{}] as unknown as DOMRectList);
    const user = userEvent.setup();
    render(<MainMenu {...props()} />);
    const play = screen.getByRole("button", { name: "Play" });
    const achievements = screen.getByRole("button", { name: "Achievements" });
    await user.keyboard("{ArrowDown}");
    expect(achievements).toHaveFocus();

    // Animated layout can send a boundary event without the player moving the pointer.
    fireEvent.pointerOver(play);
    expect(achievements).toHaveFocus();

    // Deliberate pointer movement still selects the button under the pointer.
    await user.hover(play);
    expect(play).toHaveFocus();
    clientRects.mockRestore();
  });

  it("links to Discord first in the footer", () => {
    render(<MainMenu {...props()} />);

    const discord = screen.getByRole("link", {
      name: "Join the Electrify Discord",
    });
    expect(discord).toHaveAttribute("href", "https://discord.gg/ethMFvvmup");
    expect(screen.getByRole("link", { name: "Send feedback" })).toHaveAttribute(
      "href",
      "https://forms.gle/nSpkVzcFcXMQMMgb9",
    );
    expect(
      screen.getAllByRole("link", {
        name: /Discord|feedback|About|Privacy/,
      })[0],
    ).toBe(discord);
  });
});
