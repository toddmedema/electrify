import { DAYS_PER_YEAR } from "../Constants";
import { demandByTypeAt } from "../data/DemandProfiles";
import { getDateFromMinute } from "./DateTime";
import { getSimLocation, loadSimData } from "../testing/SimData";
import { createGame } from "../testing/Simulator";
import { parseSave, serializeSave } from "../SaveGame";
import { calibrateDataCenterScenario } from "./DataCenterCalibration";
import {
  forecastCustomGameTimeline,
  summarizeYearOneOutlook,
} from "./CustomGameForecast";
import {
  createDataCenterScenario,
  configureDataCenterGrowth,
  DATA_CENTER_DIFFICULTY,
  DATA_CENTER_SEED,
  withoutDataCenterGrowth,
} from "./DataCenterScenario";

it("derives reproducible local assumptions and keeps a full current year", () => {
  const sf = getSimLocation("SF")!;
  const scenario = createDataCenterScenario(sf, 2026);
  expect(createDataCenterScenario(sf, 2026)).toEqual(scenario);
  expect(scenario.startingYear).toBe(2026);
  expect(scenario.loadAdditions?.[0].startsYear).toBe(2032);
  expect(scenario.durationMonths).toBe(192);
  expect(scenario.loadAdditions?.[0].peakW).toBeCloseTo(
    (100000000 * 1000000) / (16500 * 7.7),
  );
  expect(createDataCenterScenario(sf, 2026, 50000).loadAdditions).toEqual(
    scenario.loadAdditions,
  );
  expect(
    createDataCenterScenario(
      {
        ...sf,
        region: "East Asia",
        country: "China",
        lat: 20,
        resources: { geothermal: false },
      },
      2026,
    ).facilities,
  ).not.toEqual(scenario.facilities);
});

it("honors adjustable demand and arrival through game initialization and saves", () => {
  const location = getSimLocation("SF")!;
  loadSimData(location);
  const base = createDataCenterScenario(location, 2010);
  for (const [peakW, arrival] of [
    [0, 2011],
    [234000000, 2028],
    [500000000, 2050],
  ]) {
    const scenario = configureDataCenterGrowth(base, peakW, arrival);
    expect(scenario.facilities).toEqual(base.facilities);
    expect(scenario.durationMonths).toBeGreaterThanOrEqual(
      (arrival - 2010 + 10) * 12,
    );
    expect(scenario.eventScenarioIds).toEqual([]);
    const game = createGame({
      scenarioId: 999,
      scenario,
      difficulty: DATA_CENTER_DIFFICULTY,
      seed: DATA_CENTER_SEED,
    });
    expect(game.loadAdditions).toEqual(scenario.loadAdditions);
    expect(parseSave(serializeSave(game))?.game.loadAdditions).toEqual(
      scenario.loadAdditions,
    );
    const before = { ...game.date, year: arrival - 1, monthNumber: 12 };
    const after = { ...game.date, year: arrival, monthNumber: 1 };
    expect(
      demandByTypeAt(500000000, before, 2010, location, game.loadAdditions)[
        "Data Centers"
      ],
    ).toBe(0);
    expect(
      demandByTypeAt(500000000, after, 2010, location, game.loadAdditions)[
        "Data Centers"
      ],
    ).toBeCloseTo(peakW);
  }
  expect(
    createDataCenterScenario(location, 2049).loadAdditions?.[0].startsYear,
  ).toBe(2050);
  expect(() => createDataCenterScenario(location, 2050)).toThrow(RangeError);
  for (const [peakW, arrival] of [
    [-1, 2020],
    [NaN, 2020],
    [1, 2009],
    [1, 2010],
    [1, 2051],
    [1, 2020.5],
  ]) {
    expect(() => configureDataCenterGrowth(base, peakW, arrival)).toThrow(
      RangeError,
    );
  }
});

it("pairs ordinary demand exactly before the new campus and preserves zero-load baseline saves", () => {
  const location = getSimLocation("SF")!;
  const scenario = createDataCenterScenario(location, 2026);
  const baseline = withoutDataCenterGrowth(scenario);
  for (const minute of [0, 60 * 24 * 30, 60 * 24 * DAYS_PER_YEAR * 5]) {
    const date = getDateFromMinute(minute, 2026);
    expect(
      demandByTypeAt(500000000, date, 2026, location, baseline.loadAdditions),
    ).toEqual(
      demandByTypeAt(500000000, date, 2026, location, scenario.loadAdditions),
    );
  }
  expect(baseline.facilities).toEqual(scenario.facilities);
  expect(baseline.eventScenarioIds).toEqual([]);
  const date = getDateFromMinute(60 * 24 * DAYS_PER_YEAR * 7, 2026);
  expect(
    demandByTypeAt(500000000, date, 2026, location, baseline.loadAdditions)[
      "Data Centers"
    ],
  ).toBe(0);
  expect(
    demandByTypeAt(500000000, date, 2026, location, scenario.loadAdditions)[
      "Data Centers"
    ],
  ).toBeGreaterThan(0);
  const game = createGame({
    scenarioId: 999,
    scenario: baseline,
    difficulty: DATA_CENTER_DIFFICULTY,
    seed: DATA_CENTER_SEED,
  });
  expect(parseSave(serializeSave(game))?.game.loadAdditions).toEqual(
    baseline.loadAdditions,
  );
  expect(
    createGame({
      scenarioId: 999,
      scenario: baseline,
      difficulty: DATA_CENTER_DIFFICULTY,
      seed: DATA_CENTER_SEED,
    }).timeline,
  ).toEqual(game.timeline);
});

it.each([
  "SF",
  "PIT",
  "HNL",
  "Delhi",
  "Reykjavik",
  "Phoenix",
  "Johannesburg",
  "Manassas",
  "Asuncion",
  "Bergen",
])(
  "prepares a supplied, solvent first year in %s using the actual model",
  (id) => {
    const location = getSimLocation(id)!;
    loadSimData(location);
    const scenario = calibrateDataCenterScenario({
      location,
      startingYear: 2026,
    });
    const timeline = forecastCustomGameTimeline(
      scenario,
      DATA_CENTER_DIFFICULTY,
      DATA_CENTER_SEED,
    );
    expect(summarizeYearOneOutlook(timeline).worstShortfallW).toBe(0);
    expect(Math.min(...timeline.map((tick) => tick.cash))).toBeGreaterThan(0);
    expect(scenario.facilities.length).toBeGreaterThan(0);
  },
);

it("calibrates ordinary demand before the latest allowed opening year", () => {
  const location = getSimLocation("SF")!;
  loadSimData(location);
  const ready = calibrateDataCenterScenario({
    location,
    startingYear: 2049,
    startingCustomers: 50000,
  });
  const baseline = configureDataCenterGrowth(ready, 0, 2050);
  const growth = configureDataCenterGrowth(ready, 2000000000, 2050);
  const forecast = (scenario: typeof ready) =>
    forecastCustomGameTimeline(
      scenario,
      DATA_CENTER_DIFFICULTY,
      DATA_CENTER_SEED,
    );
  expect(summarizeYearOneOutlook(forecast(baseline)).worstShortfallW).toBe(0);
  expect(summarizeYearOneOutlook(forecast(growth)).worstShortfallW).toBe(0);
  expect(growth.facilities).toEqual(baseline.facilities);
  expect(growth.startingCustomers).toBe(50000);
});
