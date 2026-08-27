import * as React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Settings, { Props } from "./Settings";

function renderSettings(overrides: Partial<Props> = {}) {
  const props: Props = {
    settings: { units: "metric", theme: "system" },
    loggedIn: false,
    onLogin: () => undefined,
    onLogout: () => undefined,
    onChangeName: () => undefined,
    onAudioChange: () => undefined,
    onUnitsChange: () => undefined,
    onThemeChange: () => undefined,
    onExportSave: () => undefined,
    onImportSave: () => undefined,
    onBack: () => undefined,
    ...overrides,
  };
  render(<Settings {...props} />);
}

function exportButton(): HTMLButtonElement {
  return screen.getByText("Export").closest("button") as HTMLButtonElement;
}

function fileInput(): HTMLInputElement {
  return screen.getByLabelText("Save game file") as HTMLInputElement;
}

describe("Settings", () => {
  it("groups controls into labeled, scannable sections", () => {
    renderSettings();

    ["Sound", "Account", "Units", "Appearance", "Saved Game"].forEach((name) =>
      expect(screen.getByRole("region", { name })).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("checkbox", {
        name: "Music and sound effects disabled",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Measurement system" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Color theme" }),
    ).toBeInTheDocument();
  });

  it("names the saved game that Export would download", async () => {
    const onExportSave = jest.fn();
    renderSettings({ savedGame: "Rise of Renewables, 2035", onExportSave });

    expect(exportButton().disabled).toBe(false);
    expect(screen.getByText(/Rise of Renewables, 2035/)).toBeInTheDocument();

    await userEvent.click(exportButton());
    expect(onExportSave).toHaveBeenCalled();
  });

  // The button being greyed out says nothing about why, and "start a game first" is not something
  // a player would otherwise guess from a settings screen
  it("disables Export and says what's missing when there's no saved game", () => {
    renderSettings();
    expect(exportButton().disabled).toBe(true);
    expect(
      screen.getByText(/need a game in progress to export/),
    ).toBeInTheDocument();
  });

  it("offers a way in when nobody is logged in", () => {
    renderSettings();
    expect(screen.getByText("Log in")).toBeInTheDocument();
    expect(screen.queryByText("Log out")).not.toBeInTheDocument();
  });

  it("names the player and offers a rename once they're logged in", async () => {
    const onChangeName = jest.fn();
    renderSettings({ loggedIn: true, displayName: "Ada", onChangeName });

    expect(screen.getByText(/On the leaderboard as Ada/)).toBeInTheDocument();
    await userEvent.click(screen.getByText("Change name"));
    expect(onChangeName).toHaveBeenCalled();
  });

  // Logged in with no name is the state a player lands in by dismissing the first-login dialog,
  // and it is the one that leaves their scores showing as Anonymous
  it("prompts for a name when a logged-in player hasn't picked one", () => {
    renderSettings({ loggedIn: true });
    expect(
      screen.getByText(/haven't picked a leaderboard name/),
    ).toBeInTheDocument();
    expect(screen.getByText("Pick a name")).toBeInTheDocument();
  });

  it("imports whichever file the player picks, saved game or not", async () => {
    const onImportSave = jest.fn();
    renderSettings({ onImportSave });

    const file = new File(["{}"], "save.json", { type: "application/json" });
    await userEvent.upload(fileInput(), file);
    expect(onImportSave).toHaveBeenCalledWith(file);

    // Picking the same file again still counts, for the player who went and fixed a bad one
    expect(fileInput().value).toBe("");
  });
});
