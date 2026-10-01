import * as React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { DEFAULT_CUSTOM_SCENARIO } from "../../data/Scenarios";
import { createDataCenterSetupWorker } from "../../helpers/DataCenterSetupClient";
import { DataCenterSetupRequest } from "../../helpers/DataCenterSetup";
import { ScenarioType } from "../../Types";
import DataCenterSetup from "./DataCenterSetup";

jest.mock("../../helpers/DataCenterSetupClient", () => ({
  createDataCenterSetupWorker: jest.fn(),
}));
jest.mock("../../helpers/OfflineData", () => ({
  prefetchScenarioData: jest.fn(() => Promise.resolve()),
}));
jest.mock("../../data/Cities", () => {
  const { LOCATIONS } = jest.requireActual("../../Constants");
  const cities = [
    { ...LOCATIONS.SF, region: "North America" },
    { ...LOCATIONS.LA, region: "North America" },
  ];
  return { getCities: () => cities, initCities: () => Promise.resolve(cities) };
});

let worker: Worker;
let request: DataCenterSetupRequest;
const mockCreateWorker = createDataCenterSetupWorker as jest.MockedFunction<
  typeof createDataCenterSetupWorker
>;

beforeEach(() => {
  worker = {
    onmessage: null,
    onerror: null,
    postMessage: jest.fn((message: DataCenterSetupRequest) => {
      request = message;
    }),
    terminate: jest.fn(),
  } as unknown as Worker;
  mockCreateWorker.mockReturnValue(worker);
});

function preparedScenario(): ScenarioType {
  return {
    ...DEFAULT_CUSTOM_SCENARIO,
    startingYear: request.startingYear,
    locationId: request.location.id,
    location: request.location,
    seed: 1062026,
    durationMonths: 192,
    facilities: [
      { fuel: "Sun", peakW: 200000000 },
      { name: "Natural Gas CC", fuel: "Natural Gas", peakW: 2000000000 },
    ],
    eventScenarioIds: [106],
    loadAdditions: [
      {
        id: "campus",
        label: "Campus",
        demandType: "Data Centers",
        startsYear: request.startingYear + 6,
        peakW: 787000000,
        loadFactor: 0.9,
      },
    ],
  };
}

async function chooseCity(name: string) {
  const callsBefore = (worker.postMessage as jest.Mock).mock.calls.length;
  const clear = screen.queryByRole("button", { name: "Clear" });
  if (clear) fireEvent.click(clear);
  const input = screen.getByRole("combobox", { name: "Choose a nearby city" });
  fireEvent.change(input, { target: { value: name } });
  fireEvent.click(
    await screen.findByRole("option", { name: new RegExp(name) }),
  );
  await waitFor(() =>
    expect(worker.postMessage).toHaveBeenCalledTimes(callsBefore + 1),
  );
  expect(request.location.name).toContain(name);
}

function reply(scenario: ScenarioType) {
  act(() =>
    worker.onmessage?.({
      data: { requestId: request.requestId, scenario },
    } as MessageEvent),
  );
}

it("waits for an explicit location and a prepared grid, then starts paired scenarios with the same seed", async () => {
  const onStart = jest.fn();
  render(<DataCenterSetup onBack={jest.fn()} onStart={onStart} />);
  const start = screen.getByRole("button", { name: "Start exploring" });
  expect(start).toBeDisabled();
  await chooseCity("San Francisco");
  expect(start).toBeDisabled();
  expect(request.startingYear).toBe(new Date().getFullYear());
  const growth = preparedScenario();
  reply(growth);
  expect(start).toBeEnabled();
  expect(
    screen.getByRole("heading", { name: "Your starting grid is ready" }),
  ).toBeVisible();
  expect(screen.getByText("Solar: 200MW")).toBeInTheDocument();
  fireEvent.click(start);
  expect(onStart).toHaveBeenLastCalledWith(growth);
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Add data-center growth" }),
  );
  fireEvent.click(start);
  const baseline: ScenarioType = onStart.mock.calls[1][0];
  expect(baseline.seed).toBe(growth.seed);
  expect(baseline.facilities).toEqual(growth.facilities);
  expect(baseline.durationMonths).toBe(growth.durationMonths);
  expect(baseline.loadAdditions?.[0].peakW).toBe(0);
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
});

it("blocks starting and offers retry after a worker error", async () => {
  render(<DataCenterSetup onBack={jest.fn()} onStart={jest.fn()} />);
  await chooseCity("San Francisco");
  const start = screen.getByRole("button", { name: "Start exploring" });
  expect(start).toBeDisabled();
  act(() =>
    worker.onmessage?.({
      data: { requestId: request.requestId, error: "Unavailable" },
    } as MessageEvent),
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "We couldn’t prepare this grid",
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry preparation" }));
  await waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(2));
  reply(preparedScenario());
  expect(start).toBeEnabled();
});
