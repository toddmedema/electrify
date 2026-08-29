import * as React from "react";
import { render, screen } from "@testing-library/react";
import { DEFAULT_CUSTOM_SCENARIO } from "../../data/Scenarios";
import { createGame } from "../../testing/Simulator";
import CustomGame from "./CustomGame";

jest.mock("../../helpers/OfflineData", () => ({
  prefetchScenarioData: jest.fn(() => Promise.resolve()),
}));

it("opens after economic data is loaded and names every setup control", () => {
  // createGame loads the economy, matching the path that used to make this screen crash after
  // quitting an active game.
  const game = createGame({ scenarioId: 100 });
  render(
    <CustomGame
      game={game}
      scenario={{ ...DEFAULT_CUSTOM_SCENARIO }}
      onBack={jest.fn()}
      onDelta={jest.fn()}
      onStart={jest.fn()}
    />,
  );

  expect(
    screen.getByRole("heading", { name: "Custom Game Setup" }),
  ).toBeInTheDocument();
  [
    "Location",
    "Starting year",
    "Duration",
    "Ownership",
    "Starting cash",
    "Electricity rate",
    "Carbon fee",
    "Difficulty",
    "Facility type",
    "Facility size",
  ].forEach((name) => {
    expect(screen.getByRole("combobox", { name })).toBeInTheDocument();
  });
  expect(screen.getByRole("textbox", { name: "Seed" })).toBeInTheDocument();
});
