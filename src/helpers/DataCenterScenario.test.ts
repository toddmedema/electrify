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
    expect(scenario.facilities.length).toBeGreaterThan(2);
  },
);
