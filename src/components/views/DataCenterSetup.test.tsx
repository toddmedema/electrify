import * as React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { DEFAULT_CUSTOM_SCENARIO } from "../../data/Scenarios";
import {
  getDataCenterCustomerProfile,
  initDataCenterCustomers,
} from "../../data/DataCenterCustomers";
import { loadDataCenterCustomerSources } from "../../testing/SimData";
import { createDataCenterSetupWorker } from "../../helpers/DataCenterSetupClient";
import { DataCenterSetupRequest } from "../../helpers/DataCenterSetup";
import { ScenarioType } from "../../Types";
import DataCenterSetup from "./DataCenterSetup";

// Full map and native year options make these interaction tests slower under coverage.
jest.setTimeout(30000);

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

jest.mock("../../data/DataCenterCustomers", () => ({
  ...jest.requireActual("../../data/DataCenterCustomers"),
  initDataCenterCustomers: jest.fn(),
}));

const mockInitCustomers = initDataCenterCustomers as jest.MockedFunction<
  typeof initDataCenterCustomers
>;
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
  mockInitCustomers.mockResolvedValue(loadDataCenterCustomerSources());
});

function preparedScenario(): ScenarioType {
  return {
    ...DEFAULT_CUSTOM_SCENARIO,
    startingYear: request.startingYear,
    startingCustomers: request.startingCustomers,
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
  const input = screen.getByRole("combobox", {
    name: "Select a city",
  });
  fireEvent.focus(input);
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

const startButton = () =>
  screen.getByRole("button", { name: "Start exploring" });
const expectStartHidden = () =>
  expect(
    screen.queryByRole("button", { name: "Start exploring" }),
  ).not.toBeInTheDocument();

it("waits for an explicit location and a prepared grid, then starts paired scenarios with the same seed", async () => {
  const onStart = jest.fn();
  render(<DataCenterSetup onBack={jest.fn()} onStart={onStart} />);
  expectStartHidden();
  expect(
    screen.queryByRole("combobox", { name: "Start year" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("combobox", { name: "Data centers open" }),
  ).not.toBeInTheDocument();
  await chooseCity("San Francisco");
  expect(screen.getByRole("combobox", { name: "Start year" })).toBeVisible();
  expect(
    screen.getByRole("combobox", { name: "Data centers open" }),
  ).toBeVisible();
  expectStartHidden();
  expect(request.startingYear).toBe(new Date().getFullYear());
  const growth = preparedScenario();
  reply(growth);
  expect(
    screen.getByText(/Uses local weather and a regional power mix\./),
  ).toBeInTheDocument();
  expect(startButton()).toBeEnabled();
  expect(
    screen.getByRole("heading", { name: "How much extra power?" }),
  ).toBeVisible();
  expect(screen.getByRole("row", { name: "Solar 200MW" })).toBeInTheDocument();
  fireEvent.click(startButton());
  const configured: ScenarioType = onStart.mock.calls[0][0];
  expect(configured.loadAdditions?.[0].peakW).toBe(100000000);
  fireEvent.change(screen.getByRole("slider", { name: "Power needed" }), {
    target: { value: "8" },
  });
  fireEvent.click(startButton());
  const baseline: ScenarioType = onStart.mock.calls[1][0];
  expect(baseline.seed).toBe(growth.seed);
  expect(baseline.facilities).toEqual(growth.facilities);
  expect(baseline.durationMonths).toBe(configured.durationMonths);
  expect(baseline.loadAdditions?.[0].peakW).toBe(0);
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
});

it("keeps demand and arrival edits out of calibration and validates all inputs", async () => {
  const onStart = jest.fn();
  render(<DataCenterSetup onBack={jest.fn()} onStart={onStart} />);
  expect(
    screen.getByRole("group", { name: "Playable locations map" }),
  ).toBeVisible();
  await chooseCity("San Francisco");
  reply(preparedScenario());
  const demand = screen.getByRole("slider", {
    name: "Power needed",
  });
  const arrival = screen.getByRole("combobox", {
    name: "Data centers open",
  });
  expect(demand).toHaveAttribute("aria-valuetext", "100MW");
  expect(screen.queryByRole("spinbutton", { name: /Power needed/ })).toBeNull();
  for (const [tick, watts] of [
    [8, 0],
    [9, 10e6],
    [18, 100e6],
    [27, 1e9],
    [36, 10e9],
  ]) {
    fireEvent.change(demand, { target: { value: String(tick) } });
    expect(startButton()).toBeEnabled();
    fireEvent.click(startButton());
    expect(
      onStart.mock.calls[onStart.mock.calls.length - 1][0].loadAdditions[0]
        .peakW,
    ).toBe(watts);
  }
  onStart.mockClear();
  fireEvent.change(demand, { target: { value: "19" } });
  expect(within(arrival).queryByRole("option", { name: "2051" })).toBeNull();
  fireEvent.change(arrival, { target: { value: "2040" } });
  fireEvent.click(startButton());
  const scenario: ScenarioType = onStart.mock.calls[0][0];
  expect(scenario.loadAdditions?.[0]).toEqual(
    expect.objectContaining({ peakW: 200000000, startsYear: 2040 }),
  );
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
  const year = screen.getByRole("combobox", { name: "Start year" });
  expect(within(year).queryByRole("option", { name: "2009" })).toBeNull();
  expect(within(year).queryByRole("option", { name: "2050" })).toBeNull();
  fireEvent.change(year, { target: { value: "2045" } });
  expectStartHidden();
  await waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(2));
  reply(preparedScenario());
  expect(
    screen.getByRole("combobox", { name: "Data centers open" }),
  ).toHaveValue("2046");
  expect(screen.getByRole("slider", { name: "Power needed" })).toHaveValue(
    "19",
  );
  expect(startButton()).toBeEnabled();
  fireEvent.change(year, { target: { value: "2049" } });
  expect(arrival).toHaveValue("2050");
  expect(within(arrival).getAllByRole("option")).toHaveLength(1);
  fireEvent.change(year, { target: { value: "2010" } });
  expect(within(arrival).queryByRole("option", { name: "2010" })).toBeNull();
  expect(
    within(arrival).getByRole("option", { name: "2011" }),
  ).toBeInTheDocument();
});

it("selects a community using the map", async () => {
  render(<DataCenterSetup onBack={jest.fn()} onStart={jest.fn()} />);
  for (let zoom = 0; zoom < 5; zoom += 1) {
    const cluster = screen.queryByRole("button", {
      name: /Zoom to.*locations near/,
    });
    if (!cluster) break;
    fireEvent.click(cluster);
  }
  const city = await screen.findByRole("button", {
    name: /Select San Francisco/,
  });
  fireEvent.click(city);
  await waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(1));
  expect(request.location.name).toContain("San Francisco");
});

it("recalibrates edited account counts, preserving demand and resetting accounts for another location", async () => {
  const onStart = jest.fn();
  render(<DataCenterSetup onBack={jest.fn()} onStart={onStart} />);
  await chooseCity("San Francisco");
  reply(preparedScenario());
  fireEvent.change(screen.getByRole("slider", { name: "Power needed" }), {
    target: { value: "19" },
  });
  fireEvent.click(screen.getByText(/^Grid size: /));
  const accounts = screen.getByRole("spinbutton", {
    name: "Homes and businesses served",
  });
  fireEvent.change(accounts, { target: { value: "0" } });
  expectStartHidden();
  fireEvent.change(accounts, { target: { value: "123456" } });
  expectStartHidden();
  expect(accounts).toHaveValue(123456);
  await waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(2));
  expect(request.startingCustomers).toBe(123456);
  reply(preparedScenario());
  expect(screen.getByRole("slider", { name: "Power needed" })).toHaveValue(
    "19",
  );
  fireEvent.click(startButton());
  expect(onStart.mock.calls[0][0].startingCustomers).toBe(123456);
  await chooseCity("Los Angeles");
  expectStartHidden();
  expect(request.startingCustomers).toBe(
    getDataCenterCustomerProfile(
      request.location,
      loadDataCenterCustomerSources(),
    ).customers,
  );
  reply(preparedScenario());
  expect(
    screen.getByRole("spinbutton", { name: "Homes and businesses served" }),
  ).toHaveValue(request.startingCustomers!);
});

it("blocks starting and offers retry after a worker error", async () => {
  render(<DataCenterSetup onBack={jest.fn()} onStart={jest.fn()} />);
  await chooseCity("San Francisco");
  expectStartHidden();
  act(() =>
    worker.onmessage?.({
      data: { requestId: request.requestId, error: "Unavailable" },
    } as MessageEvent),
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "We couldn’t prepare this grid",
  );
  expectStartHidden();
  fireEvent.click(screen.getByRole("button", { name: "Retry preparation" }));
  await waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(2));
  reply(preparedScenario());
  expect(startButton()).toBeEnabled();
});

it("offers retry when local utility data cannot load", async () => {
  mockInitCustomers.mockRejectedValueOnce(new Error("offline"));
  render(<DataCenterSetup onBack={jest.fn()} onStart={jest.fn()} />);
  const input = screen.getByRole("combobox", { name: "Select a city" });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "San Francisco" } });
  fireEvent.click(await screen.findByRole("option", { name: /San Francisco/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "We couldn’t load local utility data",
  );
  expect(worker.postMessage).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(1));
  expect(request.customerProfile.serviceArea).toBe(
    "CleanPowerSF customers in San Francisco",
  );
  expect(request.startingCustomers).toBe(request.customerProfile.customers);
});
