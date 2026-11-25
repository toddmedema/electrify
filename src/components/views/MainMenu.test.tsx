import {
  act,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MainMenu, { Props } from "./MainMenu";
import type { DesktopBridge, DesktopState } from "../../Desktop";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import settingsReducer from "../../reducers/Settings";
import cardReducer from "../../reducers/Card";
import {
  resetInputPresentation,
  updateInputPresentation,
} from "../../desktop/InputPresentation";

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
    hasUnfinishedTutorials: false,
    onAudioChange: jest.fn(),
    onContinue: jest.fn(),
    onTutorials: jest.fn(),
    onSavedGames: jest.fn(),
    onSettings: jest.fn(),
    onMods: jest.fn(),
    onAchievements: jest.fn(),
    onManual: jest.fn(),
    onFeedback: jest.fn(),
    onStart: jest.fn(),
    ...overrides,
  };
}

// Connected menu actions share the app store.
function renderMainMenu(element: React.ReactElement) {
  const store = configureStore({
    reducer: { settings: settingsReducer, card: cardReducer },
  });
  return {
    ...render(<Provider store={store}>{element}</Provider>),
    store,
  };
}

describe("MainMenu", () => {
  afterEach(() => {
    delete window.electrifyDesktop;
    act(() => resetInputPresentation());

    jest.restoreAllMocks();
  });

  it("keeps the first-run sound prompt in the browser", () => {
    renderMainMenu(<MainMenu {...props({ audioEnabled: undefined })} />);
    expect(screen.getByRole("button", { name: "Turn on sound" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Mods" })).toBeNull();
  });

  it("opens mods just above Settings when the desktop bridge supports them, including offline", async () => {
    window.electrifyDesktop = {
      ...desktopBridge(),
      mods: async () => ({ entries: [] }),
    };
    const onMods = jest.fn();
    renderMainMenu(<MainMenu {...props({ onMods })} />);
    const resources = within(
      screen.getByRole("navigation", { name: "Game resources" }),
    );
    const buttons = resources.getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual([
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
      renderMainMenu(<MainMenu {...props({ audioEnabled })} />);
      expect(
        screen.queryByRole("button", { name: "Turn on sound" }),
      ).not.toBeInTheDocument();
    },
  );
  it("opens browser achievements from the footer", async () => {
    const onAchievements = jest.fn();
    renderMainMenu(<MainMenu {...props({ onAchievements })} />);
    expect(
      within(screen.getByRole("navigation", { name: "Game resources" }))
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Settings"]);
    await userEvent.click(screen.getByRole("button", { name: "Achievements" }));
    expect(onAchievements).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])(
    "leaves achievements to Steam from the first render, with Steam available: %s",
    async (available) => {
      window.electrifyDesktop = desktopBridge(available);
      renderMainMenu(<MainMenu {...props()} />);
      expect(
        screen.queryByRole("button", { name: "Achievements" }),
      ).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Manual" }));
      expect(
        screen.queryByRole("button", { name: "Achievements" }),
      ).not.toBeInTheDocument();
    },
  );
  it("opens game selection from Play", async () => {
    const onStart = jest.fn();
    const user = userEvent.setup();
    renderMainMenu(<MainMenu {...props({ onStart })} />);

    await user.click(screen.getByRole("button", { name: "Play" }));
    expect(onStart).toHaveBeenCalled();
    expect(screen.queryByText("Continue")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Tutorials" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Saves" }),
    ).not.toBeInTheDocument();
  });

  it("offers unfinished tutorials between Continue and Play", async () => {
    const onSavedGames = jest.fn();
    const onTutorials = jest.fn();
    renderMainMenu(
      <MainMenu
        {...props({
          hasSavedGame: true,
          hasSavedGames: true,
          hasUnfinishedTutorials: true,
          onSavedGames,
          onTutorials,
        })}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Continue" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Game resources" }),
    ).toBeInTheDocument();
    const buttons = within(
      screen.getByRole("region", { name: "Primary actions" }),
    ).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual([
      "Continue",
      "Tutorials",
      "Play",
      "Saves",
    ]);
    await userEvent.click(screen.getByRole("button", { name: "Tutorials" }));
    expect(onTutorials).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Saves" }));
    expect(onSavedGames).toHaveBeenCalledTimes(1);
  });

  it("offers the library when only finished, unplayable saves exist", () => {
    renderMainMenu(<MainMenu {...props({ hasSavedGames: true })} />);
    expect(screen.getByRole("button", { name: "Saves" })).toBeInTheDocument();
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
    renderMainMenu(<MainMenu {...props()} />);
    expect(screen.getByRole("button", { name: "Play" })).toHaveFocus();
    await user.hover(screen.getByRole("button", { name: "Manual" }));
    expect(screen.getByRole("button", { name: "Manual" })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("button", { name: "Settings" })).toHaveFocus();
    clientRects.mockRestore();
  });

  it("keeps keyboard focus when layout moves a control under a stationary pointer", async () => {
    const clientRects = jest
      .spyOn(HTMLElement.prototype, "getClientRects")
      .mockReturnValue([{}] as unknown as DOMRectList);
    const user = userEvent.setup();
    renderMainMenu(<MainMenu {...props()} />);
    const play = screen.getByRole("button", { name: "Play" });
    const settings = screen.getByRole("button", { name: "Settings" });
    await user.keyboard("{ArrowDown}");
    expect(settings).toHaveFocus();

    // Animated layout can send a boundary event without the player moving the pointer.
    fireEvent.pointerOver(play);
    expect(settings).toHaveFocus();

    // Deliberate pointer movement still selects the button under the pointer.
    await user.hover(play);
    expect(play).toHaveFocus();
    clientRects.mockRestore();
  });

  it("keeps Manual and browser Achievements in the footer and out of the central resources", async () => {
    const onManual = jest.fn();
    renderMainMenu(<MainMenu {...props({ onManual })} />);
    const footer = within(screen.getByRole("contentinfo"));
    expect(footer.getByRole("button", { name: "Manual" })).toBeVisible();
    expect(footer.getByRole("button", { name: "Achievements" })).toBeVisible();
    const resources = within(
      screen.getByRole("navigation", { name: "Game resources" }),
    );
    expect(resources.queryByRole("button", { name: "Manual" })).toBeNull();
    expect(
      resources.queryByRole("button", { name: "Achievements" }),
    ).toBeNull();
    await userEvent.click(footer.getByRole("button", { name: "Manual" }));
    expect(onManual).toHaveBeenCalledTimes(1);
  });

  it.each(["Manual", "Join the Electrify Discord"])(
    "shows the %s tooltip for controller focus without native focus-visible",
    async (name) => {
      const matches = Element.prototype.matches;
      jest.spyOn(Element.prototype, "matches").mockImplementation(function (
        this: Element,
        selector,
      ) {
        return selector === ":focus-visible"
          ? false
          : matches.call(this, selector);
      });
      renderMainMenu(<MainMenu {...props()} />);
      act(() => updateInputPresentation({ active: true, connected: true }));
      const control = screen.getByLabelText(name);
      act(() => control.focus());
      expect(await screen.findByRole("tooltip")).toHaveTextContent(name);
      await userEvent.keyboard("{Escape}");
      await waitFor(() =>
        expect(screen.queryByRole("tooltip")).not.toBeInTheDocument(),
      );
      expect(control).toHaveFocus();
    },
  );

  it("links to Discord first among the external footer links", () => {
    renderMainMenu(<MainMenu {...props()} />);

    const discord = screen.getByRole("link", {
      name: "Join the Electrify Discord",
    });
    expect(discord).toHaveAttribute("href", "https://discord.gg/ethMFvvmup");
    expect(
      screen.getAllByRole("link", {
        name: /Discord|About|Privacy/,
      })[0],
    ).toBe(discord);
  });

  it.each<[string, Partial<Props>]>([
    ["with a saved game", { hasSavedGame: true, hasSavedGames: true }],
    ["without a saved game", {}],
  ])(
    "gives exactly one action the primary style %s, never Play with friends too",
    (_name, overrides) => {
      renderMainMenu(
        <MainMenu {...props({ onPlayWithFriends: jest.fn(), ...overrides })} />,
      );
      const primary = screen
        .getAllByRole("button")
        .filter((button) => button.hasAttribute("data-main-action"));
      expect(primary).toHaveLength(1);
      expect(primary[0]).toHaveTextContent(
        overrides.hasSavedGame ? "Continue" : "Play",
      );
      expect(
        screen.getByRole("button", { name: "Play with friends" }),
      ).not.toHaveAttribute("data-main-action");
    },
  );

  it("leaves About to the text link instead of a duplicate footer icon", () => {
    renderMainMenu(<MainMenu {...props()} />);
    expect(
      within(screen.getByRole("contentinfo")).queryByRole("link", {
        name: "About Electrify",
      }),
    ).toBeNull();
    expect(
      within(
        screen.getByRole("navigation", { name: "Explore Electrify" }),
      ).getByRole("link", { name: "About" }),
    ).toHaveAttribute("href", "/about.html");
  });

  it("fetches the Saved games screen as soon as Saves is on offer", () => {
    const onSavedGamesVisible = jest.fn();
    const { rerender } = renderMainMenu(
      <MainMenu {...props({ onSavedGamesVisible })} />,
    );
    expect(onSavedGamesVisible).not.toHaveBeenCalled();
    rerender(
      <MainMenu {...props({ hasSavedGames: true, onSavedGamesVisible })} />,
    );
    expect(onSavedGamesVisible).toHaveBeenCalledTimes(1);
  });

  it("opens the feedback dialog from the footer button", () => {
    const onFeedback = jest.fn();
    renderMainMenu(
      <MainMenu {...props({ onFeedback, deferServices: true })} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
    expect(onFeedback).toHaveBeenCalledTimes(1);
  });
});
