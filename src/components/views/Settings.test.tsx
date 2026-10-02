import * as React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Settings, { Props } from "./Settings";
import { clearAppCache } from "../../helpers/Cache";

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
    onBack: () => undefined,
    ...overrides,
  };
  return render(<Settings {...props} />);
}

describe("Settings", () => {
  it("changes appearance and units with direct choices", async () => {
    const onThemeChange = jest.fn();
    const onUnitsChange = jest.fn();
    renderSettings({ onThemeChange, onUnitsChange });

    await userEvent.click(screen.getByRole("button", { name: "Dark" }));
    await userEvent.click(screen.getByRole("button", { name: "Imperial" }));

    expect(onThemeChange).toHaveBeenCalledWith("dark");
    expect(onUnitsChange).toHaveBeenCalledWith("imperial");
  });

  it("controls music and sound-effects volume independently", () => {
    const onMusicVolumeChange = jest.fn();
    const onSoundEffectsVolumeChange = jest.fn();
    renderSettings({
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

    fireEvent.change(screen.getByRole("slider", { name: /music volume/i }), {
      target: { value: 35 },
    });
    fireEvent.change(screen.getByRole("slider", { name: /effects volume/i }), {
      target: { value: 80 },
    });
    expect(onMusicVolumeChange).toHaveBeenCalledWith(0.35);
    expect(onSoundEffectsVolumeChange).toHaveBeenCalledWith(0.8);
  });

  it("only shows volume controls while audio is enabled", () => {
    const view = renderSettings();

    expect(screen.queryByRole("slider", { name: /music volume/i })).toBeNull();
    expect(
      screen.queryByRole("slider", { name: /effects volume/i }),
    ).toBeNull();

    view.unmount();
    renderSettings({
      settings: {
        audioEnabled: true,
        musicVolume: 1,
        soundEffectsVolume: 1,
        units: "metric",
        theme: "system",
      },
    });

    expect(screen.getByRole("slider", { name: /music volume/i })).toBeVisible();
    expect(
      screen.getByRole("slider", { name: /effects volume/i }),
    ).toBeVisible();
  });

  it("opens save management even when no game has been saved yet", async () => {
    const onManageSaves = jest.fn();
    renderSettings({ onManageSaves });
    await userEvent.click(screen.getByRole("button", { name: "Manage saves" }));
    expect(onManageSaves).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(/Sign in for cloud backup and access on other devices/),
    ).toBeInTheDocument();
  });

  it("offers a way in when nobody is logged in", () => {
    renderSettings();
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

    const button = screen.getByRole("button", { name: "Clear cached data" });
    expect(
      within(screen.getByRole("contentinfo")).getByRole("button", {
        name: "Clear cached data",
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
});
