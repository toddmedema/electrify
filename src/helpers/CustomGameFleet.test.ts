import { generatorMaxPeakW } from "../data/FacilityCapacity";
import { COOP_CUSTOM_FACILITY_LIMIT } from "../Constants";
import { DEFAULT_CUSTOM_SCENARIO } from "../data/Scenarios";
import { getSimLocation, loadSimData } from "../testing/SimData";
import { forecastCustomGameYearOne } from "./CustomGameForecast";
import { sizeCustomGameFleet } from "./CustomGameFleet";
import { createGame } from "../testing/Simulator";
import { ScenarioType } from "../Types";
import { DIFFICULTY_IDS } from "../Constants";

const setup = (id: string, patch: Partial<ScenarioType> = {}): ScenarioType => {
  const location = getSimLocation(id)!;
  loadSimData(location);
  return {
    ...DEFAULT_CUSTOM_SCENARIO,
    locationId: location.id,
    location,
    ...patch,
  };
};

it("sizes Austin's default setup into a local blend that serves the whole first year", () => {
  const scenario = setup("Austin");
  const facilities = sizeCustomGameFleet(scenario, 12345);
  // Not one gas peaker: the state's mix of baseload, gas and renewables.
  expect(facilities.length).toBeGreaterThan(3);
  expect(
    new Set(facilities.map((facility) => facility.fuel)).size,
  ).toBeGreaterThan(3);
  expect(facilities.every((facility) => !!facility.name)).toBe(true);
  expect(
    facilities.every((facility) => (facility.initialAgeYears || 0) > 0),
  ).toBe(true);
  // Nameplates are built to two significant digits, so the list shows what the game will hold.
  expect(
    facilities.every(
      (facility) =>
        Number(facility.peakW!.toPrecision(2)) === facility.peakW ||
        !!facility.hydroSiteId,
    ),
  ).toBe(true);
  for (const difficulty of DIFFICULTY_IDS)
    expect(
      forecastCustomGameYearOne({ ...scenario, facilities }, difficulty, 12345)
        .worstShortfallW,
    ).toBe(0);
});

it("scales the fleet with customers, so a larger utility is not left short", () => {
  const small = setup("Austin", { startingCustomers: 250000 });
  const large = { ...small, startingCustomers: 2000000 };
  const total = (scenario: ScenarioType) =>
    sizeCustomGameFleet(scenario, 7).reduce(
      (sum, facility) => sum + (facility.peakW || 0),
      0,
    );
  const smallTotal = total(small);
  const largeTotal = total(large);
  expect(largeTotal).toBeGreaterThan(smallTotal * 4);
  expect(
    forecastCustomGameYearOne(
      { ...large, facilities: sizeCustomGameFleet(large, 7) },
      "CEO",
      7,
    ).worstShortfallW,
  ).toBe(0);
});

it("offers only technologies that exist in the starting year", () => {
  const scenario = setup("SF", { startingYear: 1980 });
  const facilities = sizeCustomGameFleet(scenario, 3);
  expect(facilities.length).toBeGreaterThan(0);
  // No solar, wind or batteries before the era that built them
  expect(facilities.map((facility) => facility.name)).not.toContain("Solar");
  expect(
    forecastCustomGameYearOne({ ...scenario, facilities }, "CEO", 3)
      .worstShortfallW,
  ).toBe(0);
});

it.each([
  ["Austin", 2020],
  ["SF", 2020],
  ["Delhi", 2050],
  ["Reykjavik", 2020],
  ["Austin", 2100],
])(
  "every plant in %s's %i fleet is one the game really starts with",
  (id, startingYear) => {
    const scenario = setup(id, { startingYear });
    const facilities = sizeCustomGameFleet(scenario, 11);
    const game = createGame({
      scenarioId: 999,
      scenario: { ...scenario, facilities },
      seed: 11,
    });
    // initGame silently drops a starting plant its catalog cannot match, which would leave the
    // setup screen listing a plant the player never receives.
    expect(game.facilities).toHaveLength(facilities.length);
    expect(facilities.length).toBeLessThanOrEqual(COOP_CUSTOM_FACILITY_LIMIT);
    for (const facility of facilities.filter((plant) => !plant.hydroSiteId)) {
      expect(facility.peakW).toBeLessThanOrEqual(
        generatorMaxPeakW(game, facility.name!),
      );
    }
  },
);
