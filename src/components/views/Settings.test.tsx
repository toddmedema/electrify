import * as React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Settings, { Props } from "./Settings";

function renderSettings(overrides: Partial<Props> = {}) {
  const props: Props = {
    settings: { units: "metric" },
    onAudioChange: () => undefined,
    onUnitsChange: () => undefined,
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
