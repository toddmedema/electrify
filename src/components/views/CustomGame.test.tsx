import * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { RESERVE_MARGIN } from "../../Constants";
import {
  CUSTOM_SCENARIO_ID,
  DEFAULT_CUSTOM_SCENARIO,
} from "../../data/Scenarios";
import { getFuelEscalation } from "../../data/FuelPrices";
import { LOCATIONS } from "../../Constants";
import { prefetchScenarioData } from "../../helpers/OfflineData";
import { createCustomGameForecastWorker } from "../../helpers/CustomGameForecastClient";
import { createGame } from "../../testing/Simulator";
import CustomGame from "./CustomGame";

jest.mock("../../helpers/OfflineData", () => ({
  prefetchScenarioData: jest.fn(() => Promise.resolve()),
}));
jest.mock("../../helpers/CustomGameForecastClient", () => ({
  createCustomGameForecastWorker: jest.fn(),
}));

const mockCreateForecastWorker =
  createCustomGameForecastWorker as jest.MockedFunction<
    typeof createCustomGameForecastWorker
  >;

function forecastWorkerStub(): Worker {
  return {
    onmessage: null,
    onerror: null,
    postMessage: jest.fn(),
    terminate: jest.fn(),
  } as unknown as Worker;
}

beforeEach(() => {
  mockCreateForecastWorker.mockReturnValue(forecastWorkerStub());
});

afterEach(() => {
  jest.useRealTimers();
  mockCreateForecastWorker.mockReset();
});

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
  expect(
    screen.getByRole("region", { name: "Game setup" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("region", { name: "Facilities" }),
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

it("shows an accessible Year 1 outlook and starts with its preview seed", () => {
  jest.useFakeTimers();
  const onStart = jest.fn();
  const worker = forecastWorkerStub();
  mockCreateForecastWorker.mockReturnValue(worker);

  render(
    <CustomGame
      game={createGame({ scenarioId: 100 })}
      scenario={{ ...DEFAULT_CUSTOM_SCENARIO, seed: undefined }}
      onBack={jest.fn()}
      onDelta={jest.fn()}
      onStart={onStart}
    />,
  );

  expect(
    screen.getByRole("region", { name: "Year 1 outlook" }),
  ).toHaveAttribute("aria-busy", "true");
  act(() => jest.advanceTimersByTime(250));
  const request = (worker.postMessage as jest.Mock).mock.calls[0][0];
  act(() => {
    worker.onmessage?.({
      data: {
        requestId: request.requestId,
        outlook: { demandServed: 0.974, worstShortfallW: 180_000_000 },
      },
    } as MessageEvent);
  });

  expect(screen.getByText("Deficit forecast")).toBeInTheDocument();
  expect(screen.getByText("97%")).toBeInTheDocument();
  expect(screen.getByText("Up to 180MW short")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  expect(onStart).toHaveBeenCalledWith(
    expect.objectContaining({ seed: request.seed }),
  );
});

it("keeps Play available when the optional outlook fails", () => {
  jest.useFakeTimers();
  const worker = forecastWorkerStub();
  mockCreateForecastWorker.mockReturnValue(worker);
  render(
    <CustomGame
      game={createGame({ scenarioId: 100 })}
      scenario={{ ...DEFAULT_CUSTOM_SCENARIO }}
      onBack={jest.fn()}
      onDelta={jest.fn()}
      onStart={jest.fn()}
    />,
  );

  act(() => jest.advanceTimersByTime(250));
  act(() =>
    worker.onerror?.({ preventDefault: jest.fn() } as unknown as ErrorEvent),
  );

  expect(screen.getByText("Year 1 outlook unavailable.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Play" })).toBeEnabled();
});

it("ignores an older forecast result after the setup changes", () => {
  jest.useFakeTimers();
  const worker = forecastWorkerStub();
  mockCreateForecastWorker.mockReturnValue(worker);
  render(
    <CustomGame
      game={createGame({ scenarioId: 100 })}
      scenario={{ ...DEFAULT_CUSTOM_SCENARIO }}
      onBack={jest.fn()}
      onDelta={jest.fn()}
      onStart={jest.fn()}
    />,
  );

  act(() => jest.advanceTimersByTime(250));
  const firstRequest = (worker.postMessage as jest.Mock).mock.calls[0][0];
  fireEvent.change(screen.getByRole("slider", { name: "Starting customers" }), {
    target: { value: 2_000_000 },
  });
  act(() => jest.advanceTimersByTime(250));
  const secondRequest = (worker.postMessage as jest.Mock).mock.calls[1][0];
  act(() => {
    worker.onmessage?.({
      data: {
        requestId: secondRequest.requestId,
        outlook: { demandServed: 1, worstShortfallW: 0 },
      },
    } as MessageEvent);
    worker.onmessage?.({
      data: {
        requestId: firstRequest.requestId,
        outlook: { demandServed: 0.5, worstShortfallW: 50_000_000 },
      },
    } as MessageEvent);
  });

  expect(screen.getByText("Demand covered")).toBeInTheDocument();
  expect(screen.queryByText("Deficit forecast")).not.toBeInTheDocument();
});

it("does not forecast a facility that is unavailable in the selected year", () => {
  render(
    <CustomGame
      game={createGame({ scenarioId: 100 })}
      scenario={{
        ...DEFAULT_CUSTOM_SCENARIO,
        startingYear: 1980,
        facilities: [{ name: "Solar", peakW: 500_000_000 }],
      }}
      onBack={jest.fn()}
      onDelta={jest.fn()}
      onStart={jest.fn()}
    />,
  );

  expect(
    screen.getByText("Fix the facility issue to calculate an outlook."),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
  expect(mockCreateForecastWorker).not.toHaveBeenCalled();
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
  expect(
    screen.getByRole("combobox", { name: "Search playable cities" }),
  ).toHaveValue(LOCATIONS.HNL.name);
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
