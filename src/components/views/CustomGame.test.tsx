import * as React from "react";
import {
  act,
  fireEvent,
  isInaccessible,
  render,
  screen,
} from "@testing-library/react";
import { DEFAULT_CUSTOM_SCENARIO, SCENARIOS } from "../../data/Scenarios";
import { getFuelEscalation } from "../../data/FuelPrices";
import { inEraRate } from "../../data/RetailRates";
import { COOP_CUSTOM_FACILITY_LIMIT, LOCATIONS } from "../../Constants";
import { prefetchLocationWeather } from "../../OfflineWeatherData";
import { createCustomGameForecastWorker } from "../../helpers/CustomGameForecastClient";
import { createCustomGameFleetWorker } from "../../helpers/CustomGameFleetClient";
import type { ScenarioFacilityType, ScenarioType } from "../../Types";
import { createGame } from "../../testing/Simulator";
import type { CoopSelectionType } from "../../Types";
import CustomGame from "./CustomGame";

jest.mock("../../OfflineWeatherData", () => ({
  prefetchLocationWeather: jest.fn(() => Promise.resolve()),
}));
jest.mock("../../helpers/CustomGameForecastClient", () => ({
  createCustomGameForecastWorker: jest.fn(),
}));
jest.mock("../../helpers/CustomGameFleetClient", () => ({
  createCustomGameFleetWorker: jest.fn(),
}));

const mockCreateForecastWorker =
  createCustomGameForecastWorker as jest.MockedFunction<
    typeof createCustomGameForecastWorker
  >;

const mockCreateFleetWorker =
  createCustomGameFleetWorker as jest.MockedFunction<
    typeof createCustomGameFleetWorker
  >;

function forecastWorkerStub(): Worker {
  return {
    onmessage: null,
    onerror: null,
    postMessage: jest.fn(),
    terminate: jest.fn(),
  } as unknown as Worker;
}

let fleetWorker: Worker;
beforeEach(() => {
  mockCreateForecastWorker.mockReturnValue(forecastWorkerStub());
  fleetWorker = forecastWorkerStub();
  mockCreateFleetWorker.mockReturnValue(fleetWorker);
});

afterEach(() => {
  jest.useRealTimers();
  mockCreateForecastWorker.mockReset();
  mockCreateFleetWorker.mockReset();
});

// The shipped default opens with one peaker, which the screen replaces with a sized local blend.
// Most tests start from a fleet the player already has, so nothing is waiting to be sized.
const SIZED: ScenarioType = {
  ...DEFAULT_CUSTOM_SCENARIO,
  facilities: [
    ...DEFAULT_CUSTOM_SCENARIO.facilities,
    { name: "Natural Gas CC", peakW: 100_000_000, initialAgeYears: 5 },
  ],
};

/** Answers the pending fleet-sizing request, as the worker would. */
function answerFleet(
  facilities: ScenarioFacilityType[] = SIZED.facilities,
  worker: Worker = fleetWorker,
) {
  act(() => jest.advanceTimersByTime(250));
  const request = (worker.postMessage as jest.Mock).mock.calls.at(-1)[0];
  act(() => {
    worker.onmessage?.({
      data: { requestId: request.requestId, facilities },
    } as MessageEvent);
  });
  return request;
}

// Check one labelled control instead of recomputing names for every setup select.
function setupCombobox(name: string) {
  const control = screen.getByLabelText(name);
  expect(control).toHaveRole("combobox");
  expect(control).toHaveAccessibleName(name);
  expect(isInaccessible(control)).toBe(false);
  return control;
}

it("opens after economic data is loaded and names every setup control", () => {
  // createGame loads the economy, matching the path that used to make this screen crash after
  // quitting an active game.
  const game = createGame({ scenarioId: 100 });
  render(
    <CustomGame
      game={game}
      scenario={{ ...SIZED }}
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
    "Carbon fee",
    "Difficulty",
    "Facility type",
    "Facility size",
  ].forEach((name) => {
    expect(setupCombobox(name)).toBeInTheDocument();
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
      scenario={{ ...SIZED, seed: undefined }}
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
  fireEvent.click(screen.getByRole("button", { name: "Start game" }));
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
      scenario={{ ...SIZED }}
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
  expect(screen.getByRole("button", { name: "Start game" })).toBeEnabled();
});

it("starts a managed fleet with biomass below the manual picker minimum", () => {
  jest.useFakeTimers();
  const onStart = jest.fn();
  render(
    <CustomGame
      game={createGame({ scenarioId: 100 })}
      scenario={{ ...DEFAULT_CUSTOM_SCENARIO, startingFleetSource: "regional" }}
      onBack={jest.fn()}
      onDelta={jest.fn()}
      onStart={onStart}
    />,
  );

  answerFleet([{ name: "Biomass", fuel: "Biomass", peakW: 1_000_000 }]);
  expect(screen.getByRole("button", { name: "Remove Biomass" })).toBeVisible();
  fireEvent.mouseDown(setupCombobox("Facility type"));
  expect(
    screen.queryByRole("option", { name: "Biomass" }),
  ).not.toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });

  const start = screen.getByRole("button", { name: "Start game" });
  expect(start).toBeEnabled();
  fireEvent.click(start);
  expect(onStart).toHaveBeenCalledWith(
    expect.objectContaining({
      facilities: expect.arrayContaining([
        expect.objectContaining({ name: "Biomass" }),
      ]),
    }),
  );
});

it.each(["startup", "postMessage"])(
  "recovers from a synchronous forecast %s failure without blocking Play",
  (failure) => {
    jest.useFakeTimers();
    const failedWorker = forecastWorkerStub();
    const recoveredWorker = forecastWorkerStub();
    const onStart = jest.fn();
    if (failure === "startup") {
      mockCreateForecastWorker.mockImplementationOnce(() => {
        throw new Error("Worker blocked");
      });
    } else {
      (failedWorker.postMessage as jest.Mock).mockImplementation(() => {
        throw new DOMException("Cannot clone request", "DataCloneError");
      });
      mockCreateForecastWorker.mockReturnValueOnce(failedWorker);
    }
    mockCreateForecastWorker.mockReturnValue(recoveredWorker);
    render(
      <CustomGame
        game={createGame({ scenarioId: 100 })}
        scenario={{ ...SIZED }}
        onBack={jest.fn()}
        onDelta={jest.fn()}
        onStart={onStart}
      />,
    );

    act(() => jest.advanceTimersByTime(250));
    expect(screen.getByText("Year 1 outlook unavailable.")).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Year 1 outlook" }),
    ).toHaveAttribute("aria-busy", "false");
    fireEvent.click(screen.getByRole("button", { name: "Start game" }));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(failedWorker.terminate).toHaveBeenCalledTimes(
      failure === "postMessage" ? 1 : 0,
    );

    fireEvent.change(
      screen.getByRole("slider", { name: "Starting customers" }),
      {
        target: { value: 2_000_000 },
      },
    );
    act(() => jest.advanceTimersByTime(250));
    const request = (recoveredWorker.postMessage as jest.Mock).mock.calls[0][0];
    act(() => {
      recoveredWorker.onmessage?.({
        data: {
          requestId: request.requestId,
          outlook: { demandServed: 1, worstShortfallW: 0 },
        },
      } as MessageEvent);
    });
    expect(screen.getByText("Demand covered")).toBeInTheDocument();
    expect(
      screen.queryByText("Year 1 outlook unavailable."),
    ).not.toBeInTheDocument();
  },
);

it.each<[number, string]>([
  [3, "300%"],
  [1.294, "130%"],
  [1.045, "100%"],
  [0.9991, "<100%"],
])(
  "ignores an older forecast result and caps the current coverage %s",
  (demandServed, label) => {
    jest.useFakeTimers();
    const worker = forecastWorkerStub();
    mockCreateForecastWorker.mockReturnValue(worker);
    render(
      <CustomGame
        game={createGame({ scenarioId: 100 })}
        scenario={{ ...SIZED }}
        onBack={jest.fn()}
        onDelta={jest.fn()}
        onStart={jest.fn()}
      />,
    );

    act(() => jest.advanceTimersByTime(250));
    const firstRequest = (worker.postMessage as jest.Mock).mock.calls[0][0];
    fireEvent.change(
      screen.getByRole("slider", { name: "Starting customers" }),
      {
        target: { value: 2_000_000 },
      },
    );
    act(() => jest.advanceTimersByTime(250));
    const secondRequest = (worker.postMessage as jest.Mock).mock.calls[1][0];
    act(() => {
      worker.onmessage?.({
        data: {
          requestId: secondRequest.requestId,
          outlook: { demandServed, worstShortfallW: 0 },
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
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByText("Deficit forecast")).not.toBeInTheDocument();
  },
);

it("does not forecast a facility that is unavailable in the selected year", () => {
  render(
    <CustomGame
      game={createGame({ scenarioId: 100 })}
      scenario={{
        ...DEFAULT_CUSTOM_SCENARIO,
        startingYear: 1980,
        // An era-scaled rate, so the rate select has a matching option
        dollarsPerkWh: inEraRate(DEFAULT_CUSTOM_SCENARIO.dollarsPerkWh, 1980),
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
  expect(screen.getByRole("button", { name: "Start game" })).toBeDisabled();
  expect(mockCreateForecastWorker).not.toHaveBeenCalled();
});

it("blocks a retained facility when its capacity exceeds the selected year's limit", () => {
  const onStart = jest.fn();
  render(
    <CustomGame
      game={createGame({ scenarioId: 100 })}
      scenario={{
        ...DEFAULT_CUSTOM_SCENARIO,
        facilities: [{ name: "Battery", peakWh: 100_000_000 }],
      }}
      onBack={jest.fn()}
      onDelta={jest.fn()}
      onStart={onStart}
    />,
  );

  const start = screen.getByRole("button", { name: "Start game" });
  expect(start).toBeEnabled();
  fireEvent.mouseDown(setupCombobox("Starting year"));
  fireEvent.click(screen.getByRole("option", { name: "2010" }));
  expect(start).toBeDisabled();
  expect(screen.getByRole("button", { name: "Remove Battery" })).toBeVisible();
  fireEvent.click(start);
  expect(onStart).not.toHaveBeenCalled();

  fireEvent.mouseDown(setupCombobox("Starting year"));
  fireEvent.click(screen.getByRole("option", { name: "2020" }));
  expect(start).toBeEnabled();
});

const readyCoopHost: CoopSelectionType = {
  role: "host",
  hostName: "Alice",
  players: [
    { id: "a", name: "Alice", host: true, connected: true, ready: false },
    { id: "b", name: "Bob", host: false, connected: true, ready: true },
  ],
  ready: false,
  starting: false,
};

it("allows a co-op host to reach the facility limit and prevents another addition", () => {
  const onScenarioChange = jest.fn();
  render(
    <CustomGame
      game={createGame({ scenarioId: 100 })}
      scenario={{
        ...DEFAULT_CUSTOM_SCENARIO,
        facilities: Array.from(
          { length: COOP_CUSTOM_FACILITY_LIMIT - 1 },
          () => ({ name: "Coal", peakW: 100_000_000 }),
        ),
      }}
      coop={readyCoopHost}
      onBack={jest.fn()}
      onDelta={jest.fn()}
      onStart={jest.fn()}
      onScenarioChange={onScenarioChange}
    />,
  );

  fireEvent.mouseDown(setupCombobox("Facility type"));
  fireEvent.click(screen.getByRole("option", { name: "Coal" }));
  const add = screen.getByRole("button", { name: "Add facility" });
  expect(add).toBeEnabled();
  fireEvent.click(add);
  expect(onScenarioChange.mock.lastCall?.[0].facilities).toHaveLength(
    COOP_CUSTOM_FACILITY_LIMIT,
  );
  expect(add).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Start for everyone" }),
  ).toBeEnabled();
  expect(screen.getByText(/co-op games support up to/i)).toBeVisible();
});

it("lets a host repair an oversized recalled fleet before sharing or starting it", () => {
  const onStart = jest.fn();
  const onScenarioChange = jest.fn();
  render(
    <CustomGame
      game={createGame({ scenarioId: 100 })}
      scenario={{
        ...DEFAULT_CUSTOM_SCENARIO,
        facilities: Array.from(
          { length: COOP_CUSTOM_FACILITY_LIMIT + 1 },
          () => ({ name: "Coal", peakW: 100_000_000 }),
        ),
      }}
      coop={readyCoopHost}
      onBack={jest.fn()}
      onDelta={jest.fn()}
      onStart={onStart}
      onScenarioChange={onScenarioChange}
    />,
  );

  const start = screen.getByRole("button", { name: "Start for everyone" });
  expect(start).toBeDisabled();
  expect(onScenarioChange.mock.calls).toEqual([[undefined]]);
  fireEvent.click(screen.getAllByRole("button", { name: "Remove Coal" })[0]);
  expect(onScenarioChange.mock.lastCall?.[0].facilities).toHaveLength(
    COOP_CUSTOM_FACILITY_LIMIT,
  );
  expect(start).toBeEnabled();
  fireEvent.click(start);
  expect(onStart.mock.lastCall?.[0].facilities).toHaveLength(
    COOP_CUSTOM_FACILITY_LIMIT,
  );
});

it("re-quotes starting cash when the starting year changes", () => {
  jest.useFakeTimers();
  const onStart = jest.fn();
  render(
    <CustomGame
      game={createGame({ scenarioId: 100 })}
      scenario={{ ...SIZED, startingFleetSource: "regional", cash: 500000000 }}
      onBack={jest.fn()}
      onDelta={jest.fn()}
      onStart={onStart}
    />,
  );

  fireEvent.mouseDown(screen.getByRole("combobox", { name: "Starting year" }));
  fireEvent.click(screen.getByRole("option", { name: "2080" }));
  answerFleet();
  fireEvent.click(screen.getByRole("button", { name: "Start game" }));

  const inflation = getFuelEscalation(2080) / getFuelEscalation(2020);
  const expectedCash = Number((500000000 * inflation).toPrecision(2));
  expect(onStart).toHaveBeenCalledWith(
    expect.objectContaining({ startingYear: 2080, cash: expectedCash }),
  );
});

it("quotes electricity rates at the prices of a historical starting year", () => {
  jest.useFakeTimers();
  const onStart = jest.fn();
  render(
    <CustomGame
      game={createGame({ scenarioId: 100 })}
      scenario={{
        ...SIZED,
        startingFleetSource: "regional",
        dollarsPerkWh: 0.05,
      }}
      onBack={jest.fn()}
      onDelta={jest.fn()}
      onStart={onStart}
    />,
  );

  fireEvent.mouseDown(screen.getByRole("combobox", { name: "Starting year" }));
  fireEvent.click(screen.getByRole("option", { name: "1980" }));
  expect(
    screen.queryByRole("combobox", { name: "Electricity rate" }),
  ).not.toBeInTheDocument();
  // Era-appropriate plants: nothing built after 1980
  answerFleet([{ name: "Coal", fuel: "Coal", peakW: 400_000_000 }]);
  fireEvent.click(screen.getByRole("button", { name: "Start game" }));

  expect(onStart).toHaveBeenCalledWith(
    expect.objectContaining({
      startingYear: 1980,
      dollarsPerkWh: inEraRate(
        SCENARIOS.find(
          (s) =>
            s.locationId === DEFAULT_CUSTOM_SCENARIO.locationId &&
            !s.tutorialSteps,
        )!.dollarsPerkWh,
        1980,
        SCENARIOS.find(
          (s) =>
            s.locationId === DEFAULT_CUSTOM_SCENARIO.locationId &&
            !s.tutorialSteps,
        )!.startingYear,
      ),
    }),
  );
});

it("sizes a starting grid for the setup it opens with", () => {
  jest.useFakeTimers();
  const forecast = forecastWorkerStub();
  mockCreateForecastWorker.mockReturnValue(forecast);
  const onStart = jest.fn();
  render(
    <CustomGame
      game={createGame({ scenarioId: 100 })}
      scenario={{
        ...DEFAULT_CUSTOM_SCENARIO,
        startingFleetSource: "regional",
        seed: 4242,
      }}
      onBack={jest.fn()}
      onDelta={jest.fn()}
      onStart={onStart}
    />,
  );

  // Nothing is forecast or started until the grid it would forecast has been sized.
  expect(
    screen.getByText("Sizing the starting grid to local demand…"),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Start game" })).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: "Remove Natural Gas Peaker" }),
  ).not.toBeInTheDocument();
  const request = answerFleet([
    { name: "Coal", fuel: "Coal", peakW: 140_000_000, initialAgeYears: 32 },
    { name: "Wind", fuel: "Wind", peakW: 220_000_000, initialAgeYears: 7 },
  ]);
  expect(request).toMatchObject({
    seed: 4242,
    scenario: expect.objectContaining({
      locationId: DEFAULT_CUSTOM_SCENARIO.locationId,
      startingYear: 2020,
      startingCustomers: 1_000_000,
    }),
  });

  expect(
    screen.getByRole("button", { name: "Remove Coal" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Remove Wind" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Remove Natural Gas Peaker" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Start game" })).toBeEnabled();
  // The year 1 outlook is then worked out for the fleet that will be played.
  act(() => jest.advanceTimersByTime(250));
  expect(forecast.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      scenario: expect.objectContaining({
        facilities: [
          expect.objectContaining({ name: "Coal" }),
          expect.objectContaining({ name: "Wind" }),
        ],
      }),
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Start game" }));
  expect(onStart).toHaveBeenCalledWith(
    expect.objectContaining({
      facilities: [
        expect.objectContaining({ name: "Coal" }),
        expect.objectContaining({ name: "Wind" }),
      ],
    }),
  );
});

it("only shares a custom setup once the starting grid has settled", () => {
  jest.useFakeTimers();
  const onScenarioChange = jest.fn();
  render(
    <CustomGame
      game={createGame({ scenarioId: 100 })}
      scenario={{
        ...DEFAULT_CUSTOM_SCENARIO,
        startingFleetSource: "regional",
        seed: 4242,
      }}
      coop={{
        role: "host",
        hostName: "Ada",
        players: [],
        ready: false,
        starting: false,
      }}
      onBack={jest.fn()}
      onDelta={jest.fn()}
      onStart={jest.fn()}
      onScenarioChange={onScenarioChange}
    />,
  );

  expect(onScenarioChange.mock.calls).toEqual([[undefined]]);
  answerFleet();
  expect(onScenarioChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ facilities: SIZED.facilities, seed: 4242 }),
  );

  fireEvent.change(screen.getByRole("slider", { name: "Starting customers" }), {
    target: { value: 2000000 },
  });
  expect(onScenarioChange).toHaveBeenLastCalledWith(undefined);
  const facilities = [
    { name: "Coal", fuel: "Coal", peakW: 900_000_000 },
  ] satisfies ScenarioFacilityType[];
  answerFleet(facilities);
  expect(onScenarioChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      facilities,
      startingCustomers: 2000000,
      seed: 4242,
    }),
  );
});

it("sizes the grid again when its customers, era or place change", () => {
  jest.useFakeTimers();
  render(
    <CustomGame
      game={createGame({ scenarioId: 100 })}
      scenario={{ ...SIZED, startingFleetSource: "regional" }}
      onBack={jest.fn()}
      onDelta={jest.fn()}
      onStart={jest.fn()}
    />,
  );
  expect(fleetWorker.postMessage).not.toHaveBeenCalled();
  answerFleet();

  fireEvent.change(screen.getByRole("slider", { name: "Starting customers" }), {
    target: { value: 2000000 },
  });
  expect(screen.getByRole("button", { name: "Start game" })).toBeDisabled();
  expect(
    answerFleet([{ name: "Coal", fuel: "Coal", peakW: 900_000_000 }]),
  ).toMatchObject({
    scenario: expect.objectContaining({ startingCustomers: 2_000_000 }),
  });
  expect(
    screen.getByRole("button", { name: "Remove Coal" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Start game" })).toBeEnabled();

  fireEvent.mouseDown(screen.getByRole("combobox", { name: "Starting year" }));
  fireEvent.click(screen.getByRole("option", { name: "2050" }));
  expect(screen.getByRole("button", { name: "Start game" })).toBeDisabled();
  expect(
    answerFleet([{ name: "Solar", fuel: "Sun", peakW: 1_000_000_000 }]),
  ).toMatchObject({
    scenario: expect.objectContaining({ startingYear: 2050 }),
  });

  fireEvent.click(screen.getByRole("button", { name: /Select Honolulu, HI/ }));
  expect(
    answerFleet([{ name: "Oil", fuel: "Oil", peakW: 300_000_000 }]),
  ).toMatchObject({
    scenario: expect.objectContaining({ locationId: LOCATIONS.HNL.id }),
  });
  expect(
    screen.getByRole("button", { name: "Remove Oil" }),
  ).toBeInTheDocument();
});

it.each([
  { peakW: 25_000_000, valid: true },
  { peakW: 10_000_000_000_000, valid: false },
])(
  "recalls a manual single peaker with its saved $peakW W capacity",
  ({ peakW, valid }) => {
    jest.useFakeTimers();
    const onStart = jest.fn();
    const facility = { name: "Natural Gas Peaker", peakW, initialAgeYears: 7 };
    render(
      <CustomGame
        game={createGame({ scenarioId: 100 })}
        scenario={{ ...DEFAULT_CUSTOM_SCENARIO, facilities: [facility] }}
        onBack={jest.fn()}
        onDelta={jest.fn()}
        onStart={onStart}
      />,
    );
    act(() => jest.advanceTimersByTime(300));
    expect(mockCreateFleetWorker).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Remove Natural Gas Peaker" }),
    ).toBeVisible();
    const play = screen.getByRole("button", { name: "Start game" });
    expect(play).toHaveProperty("disabled", !valid);
    fireEvent.click(play);
    expect(onStart.mock.calls.map(([scenario]) => scenario.facilities)).toEqual(
      valid ? [[facility]] : [],
    );
  },
);

it("preserves a manually edited fleet until the player requests the regional blend", () => {
  jest.useFakeTimers();
  render(
    <CustomGame
      game={createGame({ scenarioId: 100 })}
      scenario={{ ...SIZED }}
      onBack={jest.fn()}
      onDelta={jest.fn()}
      onStart={jest.fn()}
    />,
  );
  act(() => jest.advanceTimersByTime(1000));
  expect(fleetWorker.postMessage).not.toHaveBeenCalled();

  fireEvent.click(
    screen.getByRole("button", { name: "Remove Natural Gas Peaker" }),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Seed" }), {
    target: { value: "77" },
  });
  act(() => jest.advanceTimersByTime(1000));
  expect(fleetWorker.postMessage).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "Remove Natural Gas CC" }),
  ).toBeInTheDocument();

  // A manual fleet remains editable as the grid grows.
  fireEvent.change(screen.getByRole("slider", { name: "Starting customers" }), {
    target: { value: 1500000 },
  });
  act(() => jest.advanceTimersByTime(1000));
  expect(fleetWorker.postMessage).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "Remove Natural Gas CC" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Use regional fleet" }));
  expect(
    screen.getByRole("combobox", { name: "Facility type" }),
  ).toHaveAttribute("aria-disabled", "true");
  expect(screen.getByRole("button", { name: "Add facility" })).toBeDisabled();
  answerFleet([{ name: "Coal", fuel: "Coal", peakW: 600_000_000 }]);
  expect(
    screen.queryByRole("button", { name: "Remove Natural Gas CC" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Remove Coal" }),
  ).toBeInTheDocument();
});

it("keeps the fleet and Play available when sizing fails", () => {
  jest.useFakeTimers();
  const onStart = jest.fn();
  render(
    <CustomGame
      game={createGame({ scenarioId: 100 })}
      scenario={{ ...DEFAULT_CUSTOM_SCENARIO, startingFleetSource: "regional" }}
      onBack={jest.fn()}
      onDelta={jest.fn()}
      onStart={onStart}
    />,
  );
  act(() => jest.advanceTimersByTime(250));
  const request = (fleetWorker.postMessage as jest.Mock).mock.calls[0][0];
  act(() => {
    fleetWorker.onmessage?.({
      data: { requestId: request.requestId, error: "No reliable grid" },
    } as MessageEvent);
  });
  expect(
    screen.getByRole("button", { name: "Remove Natural Gas Peaker" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Start game" })).toBeEnabled();
});

it("shows a guest the host's grid without sizing one", () => {
  jest.useFakeTimers();
  render(
    <CustomGame
      game={createGame({ scenarioId: 100 })}
      scenario={{ ...DEFAULT_CUSTOM_SCENARIO }}
      coop={{ role: "guest", hostName: "Ada", players: [] } as never}
      onBack={jest.fn()}
      onDelta={jest.fn()}
      onStart={jest.fn()}
    />,
  );
  act(() => jest.advanceTimersByTime(1000));
  expect(mockCreateFleetWorker).not.toHaveBeenCalled();
});

it("commits the complete location object when a map marker is selected", () => {
  jest.useFakeTimers();
  const onStart = jest.fn();
  render(
    <CustomGame
      game={createGame({ scenarioId: 100 })}
      scenario={{ ...SIZED, startingFleetSource: "regional" }}
      onBack={jest.fn()}
      onDelta={jest.fn()}
      onStart={onStart}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: /Select Honolulu, HI/ }));
  expect(
    screen.getByRole("combobox", { name: "Search playable cities" }),
  ).toHaveValue(LOCATIONS.HNL.name);
  answerFleet();
  fireEvent.click(screen.getByRole("button", { name: "Start game" }));

  expect(onStart).toHaveBeenCalledWith(
    expect.objectContaining({
      locationId: LOCATIONS.HNL.id,
      location: expect.objectContaining(LOCATIONS.HNL),
    }),
  );
  expect(prefetchLocationWeather).toHaveBeenCalledWith(
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
        ...SIZED,
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

  fireEvent.click(screen.getByRole("button", { name: "Start game" }));
  expect(onStart).toHaveBeenCalledWith(
    expect.objectContaining({
      locationId: customLocation.id,
      location: customLocation,
    }),
  );
});

it("offers researched Hydro maxima below 100MW and rejects oversized starting fleets", () => {
  const onStart = jest.fn();
  const { rerender } = render(
    <CustomGame
      game={createGame({ scenarioId: 100 })}
      scenario={{
        ...DEFAULT_CUSTOM_SCENARIO,
        locationId: "PIT",
        location: LOCATIONS.PIT,
        facilities: [],
      }}
      onBack={jest.fn()}
      onDelta={jest.fn()}
      onStart={onStart}
    />,
  );
  fireEvent.mouseDown(setupCombobox("Facility type"));
  fireEvent.click(screen.getByRole("option", { name: "Hydro" }));
  fireEvent.mouseDown(setupCombobox("Facility size"));
  const options = screen.getAllByRole("option");
  expect(
    options.some((option) =>
      /^(\d{1,2}(\.\d+)?)MW$/.test(option.textContent || ""),
    ),
  ).toBe(true);
  fireEvent.click(options[0]);
  fireEvent.click(screen.getByRole("button", { name: "Add facility" }));
  fireEvent.click(screen.getByRole("button", { name: "Start game" }));
  expect(onStart).toHaveBeenCalledWith(
    expect.objectContaining({
      facilities: [
        expect.objectContaining({ name: "Hydro", peakW: expect.any(Number) }),
      ],
    }),
  );
  expect(onStart.mock.calls[0][0].facilities[0].peakW).toBeLessThan(100000000);
  rerender(
    <CustomGame
      key="invalid"
      game={createGame({ scenarioId: 100 })}
      scenario={{
        ...DEFAULT_CUSTOM_SCENARIO,
        locationId: "PIT",
        location: LOCATIONS.PIT,
        facilities: [{ name: "Hydro", peakW: 10000000000 }],
      }}
      onBack={jest.fn()}
      onDelta={jest.fn()}
      onStart={onStart}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Choose a smaller plant or another location",
  );
  expect(screen.getByRole("button", { name: "Start game" })).toBeDisabled();
});

it("updates setup cash and carbon fees from the selected city's currency", () => {
  const location = {
    ...LOCATIONS.SF,
    id: "currency-paris",
    name: "Paris",
    country: "France",
  };
  render(
    <CustomGame
      game={createGame({ scenarioId: 100 })}
      scenario={{
        ...SIZED,
        locationId: location.id,
        location,
      }}
      onBack={jest.fn()}
      onDelta={jest.fn()}
      onStart={jest.fn()}
    />,
  );
  expect(setupCombobox("Starting cash")).toHaveTextContent(/^€/);
  fireEvent.mouseDown(setupCombobox("Carbon fee"));
  expect(
    screen
      .getAllByRole("option")
      .some((option) => option.textContent?.startsWith("€")),
  ).toBe(true);
  fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: /Select Honolulu, HI/ }));
  expect(setupCombobox("Starting cash")).toHaveTextContent(/^\$/);
});
