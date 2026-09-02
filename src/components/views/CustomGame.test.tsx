import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { RESERVE_MARGIN } from "../../Constants";
import {
  CUSTOM_SCENARIO_ID,
  DEFAULT_CUSTOM_SCENARIO,
} from "../../data/Scenarios";
import { getFuelEscalation } from "../../data/FuelPrices";
import { LOCATIONS } from "../../Constants";
import { prefetchScenarioData } from "../../helpers/OfflineData";
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
    screen.getByRole("heading", { name: "Custom setup" }),
  ).toBeInTheDocument();
  [
    "Search playable cities",
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
  expect(
    screen.queryByText("Same seed, same weather and fuel prices."),
  ).not.toBeInTheDocument();
});

it("re-quotes starting cash when the starting year changes", () => {
  const onStart = jest.fn();
  render(
    <CustomGame
      game={createGame({ scenarioId: 100 })}
      scenario={{ ...DEFAULT_CUSTOM_SCENARIO, cash: 500000000 }}
      onBack={jest.fn()}
      onDelta={jest.fn()}
      onStart={onStart}
    />,
  );

  fireEvent.mouseDown(screen.getByRole("combobox", { name: "Starting year" }));
  fireEvent.click(screen.getByRole("option", { name: "2080" }));
  fireEvent.click(screen.getByRole("button", { name: "Play" }));

  const inflation = getFuelEscalation(2080) / getFuelEscalation(2020);
  const expectedCash = Number((500000000 * inflation).toPrecision(2));
  expect(onStart).toHaveBeenCalledWith(
    expect.objectContaining({ startingYear: 2080, cash: expectedCash }),
  );
});

it("scales starting nameplate capacity with starting customers", () => {
  const onStart = jest.fn();
  render(
    <CustomGame
      game={createGame({ scenarioId: 100 })}
      scenario={{
        ...DEFAULT_CUSTOM_SCENARIO,
        facilities: [
          ...DEFAULT_CUSTOM_SCENARIO.facilities,
          { name: "Pumped Hydro", peakWh: 500000000 },
        ],
      }}
      onBack={jest.fn()}
      onDelta={jest.fn()}
      onStart={onStart}
    />,
  );

  fireEvent.change(screen.getByRole("slider", { name: "Starting customers" }), {
    target: { value: 2000000 },
  });
  fireEvent.click(screen.getByRole("button", { name: "Play" }));

  const scenario = onStart.mock.calls[0][0];
  expect(scenario.facilities).toEqual([
    expect.objectContaining({ name: "Natural Gas", peakW: 1000000000 }),
    expect.objectContaining({ name: "Pumped Hydro", peakWh: 500000000 }),
  ]);

  const state = createGame({
    scenarioId: CUSTOM_SCENARIO_ID,
    scenario,
  });
  const totalNameplateW = state.facilities.reduce(
    (total, facility) => total + (facility.peakWh ? 0 : facility.peakW),
    0,
  );
  expect(totalNameplateW).toBeGreaterThanOrEqual(
    state.timeline[0].demandW * (1 + RESERVE_MARGIN),
  );
});

it("commits the complete location object when a map marker is selected", () => {
  const onStart = jest.fn();
  render(
    <CustomGame
      game={createGame({ scenarioId: 100 })}
      scenario={{ ...DEFAULT_CUSTOM_SCENARIO }}
      onBack={jest.fn()}
      onDelta={jest.fn()}
      onStart={onStart}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: /Select Honolulu, HI/ }));
  fireEvent.click(screen.getByRole("button", { name: "Play" }));

  expect(onStart).toHaveBeenCalledWith(
    expect.objectContaining({
      locationId: LOCATIONS.HNL.id,
      location: expect.objectContaining(LOCATIONS.HNL),
    }),
  );
  expect(prefetchScenarioData).toHaveBeenCalledWith(
    expect.objectContaining({ id: LOCATIONS.HNL.id }),
  );
});

it("preserves and exposes a playable custom location that is absent from the catalogue", () => {
  const onStart = jest.fn();
  const customLocation = {
    id: "unlisted-grid",
    name: "Unlisted Grid",
    lat: 12.5,
    long: 35.5,
    timeZone: "Etc/UTC",
  };
  render(
    <CustomGame
      game={createGame({ scenarioId: 100 })}
      scenario={{
        ...DEFAULT_CUSTOM_SCENARIO,
        locationId: customLocation.id,
        location: customLocation,
      }}
      onBack={jest.fn()}
      onDelta={jest.fn()}
      onStart={onStart}
    />,
  );

  expect(
    screen.getByRole("combobox", { name: "Search playable cities" }),
  ).toHaveValue("Unlisted Grid");
  expect(screen.queryByLabelText("Selected location")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Select Unlisted Grid" }),
  ).toHaveAttribute("aria-pressed", "true");

  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  expect(onStart).toHaveBeenCalledWith(
    expect.objectContaining({
      locationId: customLocation.id,
      location: customLocation,
    }),
  );
});
