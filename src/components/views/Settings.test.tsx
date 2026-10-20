import * as React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import Settings, { Props } from "./Settings";
import { clearAppCache } from "../../helpers/Cache";
import settingsReducer from "../../reducers/Settings";
import type { DesktopBridge } from "../../Desktop";

jest.mock("../../AppVersion", () => ({ APP_VERSION: "26sept26-1507" }));

jest.mock("../../helpers/Cache", () => ({
  clearAppCache: jest.fn(async () => undefined),
}));

const mockedClearAppCache = clearAppCache as jest.MockedFunction<
  typeof clearAppCache
>;

function renderSettings(overrides: Partial<Props> = {}) {
  const props: Props = {
    settings: {
      musicVolume: 1,
      soundEffectsVolume: 1,
      units: "metric",
      theme: "system",
    },
    loggedIn: false,
    onLogin: () => undefined,
    onLogout: () => undefined,
    onChangeName: () => undefined,
    onAudioChange: () => undefined,
    onMusicVolumeChange: () => undefined,
    onSoundEffectsVolumeChange: () => undefined,
    onUnitsChange: () => undefined,
    onThemeChange: () => undefined,
    onManageSaves: () => undefined,
    onManageMods: () => undefined,
    onBack: () => undefined,
    ...overrides,
  };
  const store = configureStore({
    reducer: { settings: settingsReducer },
    preloadedState: { settings: props.settings },
  });
  return render(
    <Provider store={store}>
      <Settings {...props} />
    </Provider>,
  );
}

describe("Settings", () => {
  afterEach(() => {
    delete window.electrifyDesktop;
    localStorage.removeItem("controllerVibrationEnabled");
    localStorage.removeItem("steamTimelineEnabled");
  });

  it("keeps desktop feedback preferences out of the browser edition", () => {
    renderSettings();
    expect(
      screen.queryByRole("switch", { name: "Controller vibration" }),
    ).toBeNull();
    expect(
      screen.queryByRole("switch", { name: "Recorded highlights" }),
    ).toBeNull();
  });

  it("offers independent saved opt-ins while muted and explains unsupported recording", async () => {
    window.electrifyDesktop = {
      apiVersion: 1,
      getState: jest.fn(async () => ({
        display: {
          fullscreen: true,
          width: 1280,
          height: 720,
          resolutions: [],
        },
        steam: {
          available: false,
          online: false,
          cloudEnabled: false,
          timelineSupported: false,
        },
      })),
      onStateChanged: jest.fn(() => () => {}),
    } as unknown as DesktopBridge;
    renderSettings({
      settings: {
        audioEnabled: false,
        musicVolume: 1,
        soundEffectsVolume: 0,
        units: "metric",
        theme: "system",
      },
    });
    const vibration = await screen.findByRole("switch", {
      name: "Controller vibration",
    });
    const recording = await screen.findByRole("switch", {
      name: "Recorded highlights",
    });
    expect(vibration).not.toBeChecked();
    expect(recording).not.toBeChecked();
    expect(screen.getByRole("switch", { name: /^Sound$/ })).not.toBeChecked();
    expect(screen.queryByRole("slider", { name: "Effects volume" })).toBeNull();
    expect(
      await screen.findByText(/Steam Game Recording is unavailable right now/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/does not start video recording/),
    ).toBeInTheDocument();
    await userEvent.click(vibration);
    await userEvent.click(recording);
    expect(vibration).toBeChecked();
    expect(recording).toBeChecked();
    expect(localStorage.getItem("controllerVibrationEnabled")).toBe("true");
    expect(localStorage.getItem("steamTimelineEnabled")).toBe("true");
    expect(screen.getByRole("switch", { name: /^Sound$/ })).not.toBeChecked();
  });
  it("offers mod management only when the desktop bridge supports it", async () => {
    const state = {
      display: { fullscreen: true, width: 1, height: 1, resolutions: [] },
      steam: { available: false, online: false, cloudEnabled: false },
    };
    window.electrifyDesktop = {
      apiVersion: 1,
      getState: jest.fn(async () => state),
      onStateChanged: jest.fn(() => () => {}),
    } as unknown as DesktopBridge;
    const { unmount } = renderSettings();
    expect(screen.queryByText("Manage mods")).toBeNull();
    unmount();
    window.electrifyDesktop = {
      ...window.electrifyDesktop,
      mods: jest.fn(async () => ({ entries: [{}, {}, {}] })),
    } as unknown as DesktopBridge;
    const onManageMods = jest.fn();
    renderSettings({ onManageMods });
    expect(await screen.findByText("3 installed")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Manage mods"));
    expect(onManageMods).toHaveBeenCalledTimes(1);
  });

  it("changes appearance and units with direct choices", async () => {
    const onThemeChange = jest.fn();
    const onUnitsChange = jest.fn();
    renderSettings({ onThemeChange, onUnitsChange });

    await userEvent.click(screen.getByRole("button", { name: "Dark" }));
    await userEvent.click(screen.getByRole("button", { name: "Imperial" }));

    expect(onThemeChange).toHaveBeenCalledWith("dark");
    expect(onUnitsChange).toHaveBeenCalledWith("imperial");
  });

  it("controls independent volumes while sound is enabled and hides them otherwise", () => {
    const onMusicVolumeChange = jest.fn();
    const onSoundEffectsVolumeChange = jest.fn();
    const view = renderSettings({
      settings: {
        audioEnabled: true,
        musicVolume: 0.7,
        soundEffectsVolume: 0.4,
        units: "metric",
        theme: "system",
      },
      onMusicVolumeChange,
      onSoundEffectsVolumeChange,
    });

    expect(screen.getByRole("slider", { name: /music volume/i })).toBeVisible();
    expect(
      screen.getByRole("slider", { name: /effects volume/i }),
    ).toBeVisible();
    fireEvent.change(screen.getByRole("slider", { name: /music volume/i }), {
      target: { value: 35 },
    });
    fireEvent.change(screen.getByRole("slider", { name: /effects volume/i }), {
      target: { value: 80 },
    });
    expect(onMusicVolumeChange).toHaveBeenCalledWith(0.35);
    expect(onSoundEffectsVolumeChange).toHaveBeenCalledWith(0.8);
    view.unmount();
    renderSettings();

    expect(screen.queryByRole("slider", { name: /music volume/i })).toBeNull();
    expect(
      screen.queryByRole("slider", { name: /effects volume/i }),
    ).toBeNull();
  });

  it("opens save management even when no game has been saved yet", async () => {
    const onManageSaves = jest.fn();
    renderSettings({ onManageSaves });
    await userEvent.click(screen.getByRole("button", { name: "Manage saves" }));
    expect(onManageSaves).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(/Sign in for cloud backup and access on other devices/),
    ).toBeInTheDocument();
    expect(screen.getByText("Sign in with Google")).toBeInTheDocument();
    expect(screen.queryByText("Log out")).not.toBeInTheDocument();
  });

  it("names the player and offers a rename once they're logged in", async () => {
    const onChangeName = jest.fn();
    renderSettings({ loggedIn: true, displayName: "Ada", onChangeName });

    expect(screen.getByText("Ada")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Edit name"));
    expect(onChangeName).toHaveBeenCalled();
  });

  // Logged in with no name is the state a player lands in by dismissing the first-login dialog,
  // and it is the one that leaves their scores showing as Anonymous
  it("prompts for a name when a logged-in player hasn't picked one", () => {
    renderSettings({ loggedIn: true });
    expect(
      screen.getByText(/Choose a public name for your scores/),
    ).toBeInTheDocument();
    expect(screen.getByText("Choose a name")).toBeInTheDocument();
  });

  it("offers a subtle cache reset at the bottom", async () => {
    renderSettings();

    expect(screen.getByText("Electrify v26sept26-1507")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Clear cache" });
    expect(
      within(screen.getByRole("contentinfo")).getByRole("button", {
        name: "Clear cache",
      }),
    ).toBe(button);
    await userEvent.click(button);

    expect(mockedClearAppCache).toHaveBeenCalledTimes(1);
  });

  it("returns focus to the control that opened Settings", () => {
    jest.useFakeTimers();
    const trigger = document.createElement("button");
    trigger.dataset.settingsTrigger = "";
    document.body.appendChild(trigger);
    const onBack = jest.fn();
    renderSettings({ onBack });

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    act(() => jest.advanceTimersByTime(350));

    expect(onBack).toHaveBeenCalled();
    expect(trigger).toHaveFocus();
    trigger.remove();
    jest.useRealTimers();
  });

  it("blurs the exiting input before calling back so rapid arrows cannot change it", () => {
    const onBack = jest.fn(() => {
      expect(effects).not.toHaveFocus();
      expect(document.body).toHaveFocus();
    });
    renderSettings({
      settings: {
        audioEnabled: true,
        musicVolume: 1,
        soundEffectsVolume: 0,
        units: "metric",
        theme: "system",
      },
      onBack,
    });
    const effects = screen.getByRole("slider", { name: "Effects volume" });
    act(() => effects.focus());
    expect(effects).toHaveFocus();
    fireEvent.keyDown(effects, { key: "Escape" });
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
