import { SCENARIOS, CUSTOM_SCENARIO_ID } from "../data/Scenarios";
import { ScenarioType } from "../Types";
import { getSimLocation } from "./SimData";
import { runSimulation, SimResultType } from "./Simulator";

jest.setTimeout(600000);

const base = SCENARIOS.find((s) => s.id === 100)!;

// A custom game with solar and gas at each site, rich enough to survive twenty years, so every
// hazard path runs through the real reducer and the invariant checks.
function customAt(locationId: string): ScenarioType {
  return {
    ...base,
    id: CUSTOM_SCENARIO_ID,
    name: `Custom ${locationId}`,
    locationId,
    location: getSimLocation(locationId),
    cash: 3000000000,
    dollarsPerkWh: 0.12,
    feePerKgCO2e: 0,
    facilities: [
      { fuel: "Sun", peakW: 200000000, initialAgeYears: 2 },
      { fuel: "Sun", peakW: 100000000, initialAgeYears: 2 },
      { fuel: "Natural Gas", peakW: 1000000000, initialAgeYears: 5 },
      { fuel: "Oil", peakW: 800000000, initialAgeYears: 5 },
    ],
  };
}

const LOCATIONS = ["Denver", "Dallas", "SF", "PIT", "Reykjavik"];
const SEEDS = [101, 202];
const MONTHS = 240;
// Distinct damaging storms at a site over twenty years, per seed.
const MAX_STORMS: Record<string, number> = {
  Denver: 3,
  Dallas: 3,
  SF: 1,
  PIT: 2,
  Reykjavik: 1,
};

const results: Record<string, SimResultType[]> = {};

beforeAll(() => {
  LOCATIONS.forEach((locationId) => {
    results[locationId] = SEEDS.map((seed) =>
      runSimulation({
        scenario: customAt(locationId),
        scenarioId: CUSTOM_SCENARIO_ID,
        seed,
        months: MONTHS,
      }),
    );
  });
});

describe("weather hazard balance (real reducer, twenty years)", () => {
  it.each(LOCATIONS)("runs clean at %s", (locationId) => {
    results[locationId].forEach((result) => {
      expect(result.violationCountByRule).toEqual({});
      expect([result.outcome, result.months.length]).toEqual([
        "completed",
        MONTHS,
      ]);
    });
  });

  it.each(LOCATIONS)(
    "keeps damaging hail to a plausible count at %s",
    (locationId) => {
      results[locationId].forEach((result) => {
        expect(result.weatherHazardImpact.hailEvents).toBeLessThanOrEqual(
          MAX_STORMS[locationId],
        );
        // Each storm damages at most the two arrays.
        expect(result.weatherHazardImpact.hailFacilityHits).toBeLessThanOrEqual(
          2 * result.weatherHazardImpact.hailEvents,
        );
      });
    },
  );

  it("sees hail somewhere in hail alley", () => {
    const storms = ["Denver", "Dallas"].reduce(
      (total, id) =>
        total +
        results[id].reduce((n, r) => n + r.weatherHazardImpact.hailEvents, 0),
      0,
    );
    expect(storms).toBeGreaterThan(0);
  });

  it("is deterministic for a seed", () => {
    const again = runSimulation({
      scenario: customAt("Denver"),
      scenarioId: CUSTOM_SCENARIO_ID,
      seed: SEEDS[0],
      months: 60,
    });
    const first = runSimulation({
      scenario: customAt("Denver"),
      scenarioId: CUSTOM_SCENARIO_ID,
      seed: SEEDS[0],
      months: 60,
    });
    expect(again.storyOccurrences).toEqual(first.storyOccurrences);
    expect(again.finalCash).toBe(first.finalCash);
  });

  it("costs something where hail is common, against a hazards-off control", () => {
    const off = runSimulation({
      scenario: customAt("Denver"),
      scenarioId: CUSTOM_SCENARIO_ID,
      seed: SEEDS[0],
      months: MONTHS,
      weatherHazardsEnabled: false,
    });
    const on = results.Denver[0];
    expect(off.weatherHazardImpact.hailEvents).toBe(0);
    expect(off.weatherHazardImpact.coldEvents).toBe(0);
    // Premiums alone make the hazard run poorer.
    expect(on.finalCash).toBeLessThan(off.finalCash);
  });
});
