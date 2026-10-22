import { DIFFICULTY_IDS } from "../Constants";
import { DEFAULT_CUSTOM_SCENARIO } from "../data/Scenarios";
import type { LocationType, ScenarioType } from "../Types";
import type { ScenarioStartingPeakResponse } from "../helpers/ScenarioStartingPeakCalculation";

const mockEconomy = jest.fn();
const mockFuelPrices = jest.fn();
const mockWeather = jest.fn();
const mockPeak = jest.fn();
jest.mock("../data/Economy", () => ({
  initEconomy: (done: (error?: string) => void) => mockEconomy(done),
}));
jest.mock("../data/FuelPrices", () => ({
  initFuelPrices: (done: (error?: string) => void) => mockFuelPrices(done),
}));
jest.mock("../data/Weather", () => ({
  initWeather: (location: LocationType, done: (error?: string) => void) =>
    mockWeather(location, done),
}));
jest.mock("../helpers/ScenarioStartingPeakCalculation", () => ({
  calculateScenarioStartingPeak: (...args: unknown[]) => mockPeak(...args),
}));

const worker = globalThis as unknown as Worker;
const originalHandler = worker.onmessage;
let reply: jest.SpyInstance;
beforeEach(() => {
  mockEconomy.mockReset().mockImplementation((done) => done());
  mockFuelPrices.mockReset().mockImplementation((done) => done());
  mockWeather.mockReset().mockImplementation((_location, done) => done());
  mockPeak.mockReset().mockReturnValue(500);
  reply = jest.spyOn(worker, "postMessage").mockImplementation(() => undefined);
  jest.isolateModules(() => require("./ScenarioStartingPeak.worker"));
});
afterEach(() => {
  worker.onmessage = originalHandler;
  reply.mockRestore();
});

async function request(
  scenario = { ...DEFAULT_CUSTOM_SCENARIO, seed: 42 },
): Promise<ScenarioStartingPeakResponse> {
  return new Promise((resolve) => {
    reply.mockImplementationOnce(resolve);
    worker.onmessage?.({ data: { scenario } } as MessageEvent<{
      scenario: ScenarioType;
    }>);
  });
}

it("loads fresh worker-owned records and computes all five difficulties with the package seed", async () => {
  const result = await request();
  expect(result).toEqual({
    peaks: { Intern: 500, Employee: 500, Manager: 500, VP: 500, CEO: 500 },
  });
  expect(mockEconomy).toHaveBeenCalledTimes(1);
  expect(mockFuelPrices).toHaveBeenCalledTimes(1);
  expect(mockWeather).toHaveBeenCalledTimes(1);
  expect(mockPeak.mock.calls.map((call) => call[1])).toEqual(DIFFICULTY_IDS);
  expect(mockPeak.mock.calls.every((call) => call[2] === 42)).toBe(true);
});

it("waits for actual weather before asking the forecast owner for a peak", async () => {
  let finish: (() => void) | undefined;
  mockWeather.mockImplementation((_location, done) => {
    finish = done;
  });
  const result = request();
  expect(mockPeak).not.toHaveBeenCalled();
  expect(reply).not.toHaveBeenCalled();
  finish!();
  expect(await result).toHaveProperty("peaks.Manager", 500);
});

it.each(["economy", "fuel", "weather"])(
  "reports a %s load failure instead of computing on fallback data",
  async (owner) => {
    if (owner === "economy")
      mockEconomy.mockImplementation((done) => done("economy offline"));
    if (owner === "fuel")
      mockFuelPrices.mockImplementation((done) => done("fuel offline"));
    if (owner === "weather")
      mockWeather.mockImplementation((_location, done) =>
        done("weather offline"),
      );
    expect(await request()).toEqual({ error: `${owner} offline` });
    expect(mockPeak).not.toHaveBeenCalled();
  },
);

it("settles the other initializers before reporting an error", async () => {
  mockFuelPrices.mockImplementation((done) => done("fuel offline"));
  let finish: (() => void) | undefined;
  mockWeather.mockImplementation((_location, done) => {
    finish = done;
  });
  const result = request();
  await Promise.resolve();
  expect(reply).not.toHaveBeenCalled();
  finish!();
  expect(await result).toEqual({ error: "fuel offline" });
});

it("does not substitute zero when the demand owner cannot resolve the peak", async () => {
  mockPeak.mockReturnValue(undefined);
  expect(await request()).toEqual({
    error: "The scenario's starting peak could not be calculated.",
  });
});

it("rejects a setup without a playable location before loading", async () => {
  expect(
    await request({
      ...DEFAULT_CUSTOM_SCENARIO,
      seed: 42,
      locationId: "not-in-catalog",
      location: undefined,
    }),
  ).toEqual({ error: "The scenario has no playable location." });
  expect(mockWeather).not.toHaveBeenCalled();
});
