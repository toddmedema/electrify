import { DIFFICULTY_IDS } from "../Constants";
import { waitFor } from "@testing-library/react";
import * as economy from "../data/Economy";
import * as fuelPrices from "../data/FuelPrices";
import { DEFAULT_CUSTOM_SCENARIO } from "../data/Scenarios";
import * as weather from "../data/Weather";
import type { CompiledScenarioRules } from "../data/ScenarioRules";
import type {
  DifficultyType,
  ScenarioType,
  TickPresentFutureType,
} from "../Types";
import { loadSimData } from "../testing/SimData";
import * as forecast from "./CustomGameForecast";
import { getScenarioLocation } from "./Locations";
import {
  prepareScenarioStartingPeak,
  resolvedScenarioStartingPeak,
  ScenarioStartingPeakResponse,
} from "./ScenarioStartingPeak";

const mockCreateWorker = jest.fn<Worker, []>();
jest.mock("./ScenarioStartingPeakClient", () => ({
  createScenarioStartingPeakWorker: () => mockCreateWorker(),
}));

function peakWorker(): Worker {
  return {
    onmessage: null,
    onerror: null,
    postMessage: jest.fn(),
    terminate: jest.fn(),
  } as unknown as Worker;
}
function completedPeaks(): Record<DifficultyType, number> {
  return { Intern: 4200, Employee: 4201, Manager: 4202, VP: 4203, CEO: 4204 };
}
function reply(worker: Worker, data: ScenarioStartingPeakResponse) {
  worker.onmessage?.({ data } as MessageEvent<ScenarioStartingPeakResponse>);
}

let exampleId = 0;
function scenario(patch: Partial<ScenarioType> = {}): ScenarioType {
  return {
    ...DEFAULT_CUSTOM_SCENARIO,
    name: `Starting peak example ${++exampleId}`,
    seed: 42,
    ...patch,
  };
}

function fakeTimeline(peak: number): TickPresentFutureType[] {
  return [{ demandW: peak / 2 }, { demandW: peak }] as TickPresentFutureType[];
}

function readyData() {
  jest.spyOn(economy, "hasEconomy").mockReturnValue(true);
  jest.spyOn(fuelPrices, "hasFuelPrices").mockReturnValue(true);
  jest.spyOn(weather, "hasWeather").mockReturnValue(true);
  jest
    .spyOn(weather, "selectWeatherLocation")
    .mockImplementation(() => undefined);
}

beforeEach(() => mockCreateWorker.mockReset());
afterEach(() => jest.restoreAllMocks());

describe("starting peak uses the demand owner", () => {
  it("matches the production first-year forecast on the same starting grid", () => {
    const setup = scenario();
    loadSimData(getScenarioLocation(setup)!);
    const expected = Math.max(
      ...forecast
        .forecastCustomGameTimeline(setup, "Manager", setup.seed!)
        .map((tick) => tick.demandW),
    );
    expect(resolvedScenarioStartingPeak(setup, "Manager", setup.seed!)).toBe(
      expected,
    );
    expect(expected).toBeGreaterThan(0);
  });

  it("retains static demand calibration and starting loads, and strips circular timed content", () => {
    readyData();
    const owner = jest
      .spyOn(forecast, "forecastCustomGameTimeline")
      .mockReturnValue(fakeTimeline(500));
    const setup = scenario({
      id: 106,
      startingDemandScale: 1.5,
      demandShapeExponent: 1.2,
      eventScenarioIds: [106],
      rules: {} as CompiledScenarioRules,
      mod: {} as ScenarioType["mod"],
      loadAdditions: [
        {
          id: "old-mine",
          label: "Old mine",
          startsYear: 2019,
          peakW: 100,
          loadFactor: 0.8,
          demandType: "Mining",
        },
        {
          id: "opening-campus",
          label: "Opening campus",
          startsYear: 2020,
          peakW: 200,
          loadFactor: 0.8,
          demandType: "Data Centers",
        },
        {
          id: "future-campus",
          label: "Future campus",
          startsYear: 2020,
          startsMonth: 2,
          peakW: 99999,
          loadFactor: 0.8,
          demandType: "Data Centers",
        },
        {
          id: "later-mine",
          label: "Later mine",
          startsYear: 2021,
          peakW: 99999,
          loadFactor: 0.8,
          demandType: "Mining",
        },
      ],
      startingYear: 2020,
    });
    const before = JSON.stringify(setup);
    expect(resolvedScenarioStartingPeak(setup, "VP", 42)).toBe(500);
    expect(owner).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 999,
        startingDemandScale: 1.5,
        demandShapeExponent: 1.2,
        loadAdditions: [setup.loadAdditions![0], setup.loadAdditions![1]],
      }),
      "VP",
      42,
    );
    const baseline = owner.mock.calls[0][0];
    expect(baseline.mod).toBeUndefined();
    expect(baseline.rules).toBeUndefined();
    expect(baseline.eventScenarioIds).toBeUndefined();
    expect(JSON.stringify(setup)).toBe(before);
  });

  it("selects the requested loaded location before calculating demand", () => {
    const setup = scenario();
    const local = getScenarioLocation(setup)!;
    loadSimData(local);
    weather.initWeatherFromRows(
      "other",
      [...weather.getRecordedWeatherRows(local.id)],
      true,
    );
    weather.selectWeatherLocation("other");
    const select = jest.spyOn(weather, "selectWeatherLocation");
    expect(resolvedScenarioStartingPeak(setup, "Employee", 42)).toBeGreaterThan(
      0,
    );
    expect(select).toHaveBeenCalledWith(local.id);
  });

  it.each([0, Number.NaN, Number.POSITIVE_INFINITY])(
    "does not use %s as a fallback peak",
    (peak) => {
      readyData();
      jest
        .spyOn(forecast, "forecastCustomGameTimeline")
        .mockReturnValue(fakeTimeline(peak));
      expect(
        resolvedScenarioStartingPeak(scenario(), "Intern", 42),
      ).toBeUndefined();
    },
  );
});

describe("starting peak data readiness", () => {
  it.each(["weather", "economy", "fuel"] as const)(
    "does not forecast before %s is ready",
    (missing) => {
      readyData();
      if (missing === "weather")
        jest.mocked(weather.hasWeather).mockReturnValue(false);
      if (missing === "economy")
        jest.mocked(economy.hasEconomy).mockReturnValue(false);
      if (missing === "fuel")
        jest.mocked(fuelPrices.hasFuelPrices).mockReturnValue(false);
      const owner = jest
        .spyOn(forecast, "forecastCustomGameTimeline")
        .mockReturnValue(fakeTimeline(500));
      const setup = scenario();
      expect(
        resolvedScenarioStartingPeak(setup, "Manager", 42),
      ).toBeUndefined();
      expect(owner).not.toHaveBeenCalled();
    },
  );

  it("requires records for the actual local and watershed locations", () => {
    const setup = scenario();
    const local = getScenarioLocation(setup)!;
    loadSimData(local);
    expect(weather.hasWeather(local)).toBe(true);
    expect(weather.hasWeather({ ...local, id: "not-loaded" })).toBe(false);
    expect(weather.hasWeather({ ...local, watershedId: "not-loaded" })).toBe(
      false,
    );
  });

  it("computes all five difficulty values once and retains them after weather changes", async () => {
    readyData();
    const initEconomy = jest.spyOn(economy, "initEconomy");
    const initFuel = jest.spyOn(fuelPrices, "initFuelPrices");
    const initWeather = jest.spyOn(weather, "initWeather");
    const worker = peakWorker();
    mockCreateWorker.mockReturnValue(worker);
    const setup = scenario();
    const first = prepareScenarioStartingPeak(setup);
    expect(prepareScenarioStartingPeak(setup)).toBe(first);
    await waitFor(() => expect(mockCreateWorker).toHaveBeenCalledTimes(1));
    reply(worker, { peaks: completedPeaks() });
    await first;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    jest.mocked(weather.hasWeather).mockReturnValue(false);
    for (const [index, difficulty] of DIFFICULTY_IDS.entries())
      expect(resolvedScenarioStartingPeak(setup, difficulty, 42)).toBe(
        4200 + index,
      );
    await prepareScenarioStartingPeak(setup);
    expect(mockCreateWorker).toHaveBeenCalledTimes(1);
    expect(initEconomy).not.toHaveBeenCalled();
    expect(initFuel).not.toHaveBeenCalled();
    expect(initWeather).not.toHaveBeenCalled();
    expect(resolvedScenarioStartingPeak(setup, "Manager", 43)).toBeUndefined();
  });

  it("keys cached values by the full baseline, difficulty and seed", () => {
    readyData();
    const owner = jest
      .spyOn(forecast, "forecastCustomGameTimeline")
      .mockReturnValue(fakeTimeline(500));
    const setup = scenario();
    resolvedScenarioStartingPeak(setup, "Manager", 42);
    resolvedScenarioStartingPeak(setup, "Manager", 42);
    resolvedScenarioStartingPeak(setup, "CEO", 42);
    resolvedScenarioStartingPeak(setup, "Manager", 43);
    resolvedScenarioStartingPeak(
      { ...setup, startingDemandScale: 2 },
      "Manager",
      42,
    );
    expect(owner).toHaveBeenCalledTimes(4);
  });

  it("prepares one isolated location at a time", async () => {
    const first = scenario();
    const next = scenario({
      location: { ...getScenarioLocation(first)!, id: "next-location" },
    });
    const firstWorker = peakWorker(),
      nextWorker = peakWorker();
    mockCreateWorker
      .mockReturnValueOnce(firstWorker)
      .mockReturnValueOnce(nextWorker);
    const one = prepareScenarioStartingPeak(first);
    const two = prepareScenarioStartingPeak(next);
    await waitFor(() => expect(mockCreateWorker).toHaveBeenCalledTimes(1));
    expect(firstWorker.postMessage).toHaveBeenCalledWith({
      scenario: expect.objectContaining({ name: first.name }),
    });
    expect(nextWorker.postMessage).not.toHaveBeenCalled();
    reply(firstWorker, { peaks: completedPeaks() });
    await waitFor(() => expect(mockCreateWorker).toHaveBeenCalledTimes(2));
    expect(nextWorker.postMessage).toHaveBeenCalledWith({
      scenario: expect.objectContaining({ name: next.name }),
    });
    reply(nextWorker, { peaks: completedPeaks() });
    await Promise.all([one, two]);
  });

  it("surfaces a failed download and permits a clean worker retry", async () => {
    const firstWorker = peakWorker(),
      nextWorker = peakWorker();
    mockCreateWorker
      .mockReturnValueOnce(firstWorker)
      .mockReturnValueOnce(nextWorker);
    const setup = scenario();
    const failed = prepareScenarioStartingPeak(setup);
    const rejected = failed.catch((error: unknown) => error);
    await waitFor(() => expect(mockCreateWorker).toHaveBeenCalledTimes(1));
    reply(firstWorker, { error: "Fuel data unavailable" });
    expect(await rejected).toEqual(new Error("Fuel data unavailable"));
    expect(firstWorker.terminate).toHaveBeenCalledTimes(1);
    const retry = prepareScenarioStartingPeak(setup);
    await waitFor(() => expect(mockCreateWorker).toHaveBeenCalledTimes(2));
    reply(nextWorker, { peaks: completedPeaks() });
    await retry;
  });

  it.each([0, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects a worker's invalid %s peak instead of marking preparation ready",
    async (peak) => {
      const worker = peakWorker();
      mockCreateWorker.mockReturnValue(worker);
      const prepared = prepareScenarioStartingPeak(scenario());
      const rejected = prepared.catch((error: unknown) => error);
      await waitFor(() => expect(mockCreateWorker).toHaveBeenCalledTimes(1));
      reply(worker, { peaks: { ...completedPeaks(), CEO: peak } });
      expect(await rejected).toEqual(
        new Error("The scenario's starting peak could not be calculated."),
      );
      expect(worker.terminate).toHaveBeenCalledTimes(1);
    },
  );

  it("reports a worker startup or runtime failure without using global data", async () => {
    mockCreateWorker.mockImplementationOnce(() => {
      throw new Error("Worker unavailable");
    });
    await expect(prepareScenarioStartingPeak(scenario())).rejects.toThrow(
      "Worker unavailable",
    );
    const worker = peakWorker();
    mockCreateWorker.mockReturnValue(worker);
    const prepared = prepareScenarioStartingPeak(scenario());
    const rejected = prepared.catch((error: unknown) => error);
    await waitFor(() => expect(mockCreateWorker).toHaveBeenCalledTimes(2));
    worker.onerror?.({
      message: "Worker stopped",
      preventDefault: jest.fn(),
    } as unknown as ErrorEvent);
    expect(await rejected).toEqual(new Error("Worker stopped"));
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("terminates a hung worker, frees the queue and clears the watchdog on successful retry", async () => {
    jest.useFakeTimers();
    try {
      const hung = peakWorker(),
        recovered = peakWorker();
      mockCreateWorker.mockReturnValueOnce(hung).mockReturnValueOnce(recovered);
      const setup = scenario();
      const prepared = prepareScenarioStartingPeak(setup);
      const rejected = prepared.catch((error: unknown) => error);
      await waitFor(() => expect(mockCreateWorker).toHaveBeenCalledTimes(1));
      expect(jest.getTimerCount()).toBe(1);
      jest.advanceTimersByTime(60000);
      expect(await rejected).toEqual(
        new Error(
          "Scenario preparation timed out. Check the connection and retry.",
        ),
      );
      expect(hung.terminate).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
      const retry = prepareScenarioStartingPeak(setup);
      await waitFor(() => expect(mockCreateWorker).toHaveBeenCalledTimes(2));
      reply(recovered, { peaks: completedPeaks() });
      await retry;
      expect(recovered.terminate).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});
