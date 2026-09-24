import { SCENARIOS, CUSTOM_SCENARIO_ID } from "../data/Scenarios";
import { ScenarioType } from "../Types";
import { getSimLocation } from "./SimData";
import { createGame, runSimulation, SimResultType } from "./Simulator";
import {
  hailOccurs,
  hazardEventKey,
  sampleHailImpacts,
} from "../helpers/Hazards";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../helpers/DateTime";

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
    // The first hail-alley run that paid for repairs, rerun with hazards off.
    const [locationId, seedIndex] = ["Denver", "Dallas"]
      .flatMap((id) => SEEDS.map((_, i) => [id, i] as const))
      .find(
        ([id, i]) => results[id][i].weatherHazardImpact.hailRepairCosts > 0,
      )!;
    const off = runSimulation({
      scenario: customAt(locationId),
      scenarioId: CUSTOM_SCENARIO_ID,
      seed: SEEDS[seedIndex],
      months: MONTHS,
      weatherHazardsEnabled: false,
    });
    const on = results[locationId][seedIndex];
    expect(off.weatherHazardImpact.hailEvents).toBe(0);
    expect(off.weatherHazardImpact.coldEvents).toBe(0);
    expect(on.finalCash).toBeLessThan(off.finalCash);
  });
});

describe("damaging hail across many seeds (pure occurrence draws)", () => {
  const PROBE_SEEDS = 300;

  /** Share of 20-year runs with each count of storms that damage the balance fleet. */
  function stormCounts(locationId: string): number[] {
    const scenario = customAt(locationId);
    const template = createGame({
      scenarioId: CUSTOM_SCENARIO_ID,
      scenario,
      seed: 1,
    });
    return Array.from({ length: PROBE_SEEDS }, (_, i) => {
      const probe = { ...template, seed: i + 1 };
      let storms = 0;
      for (let month = 1; month <= MONTHS; month++) {
        const date = getDateFromMinute(
          month * MINUTES_PER_MONTH,
          probe.startingYear,
        );
        const key = hazardEventKey("HAIL", locationId, month);
        if (
          hailOccurs(probe, key, date.monthNumber - 1) &&
          sampleHailImpacts({ game: probe, key }).length
        ) {
          storms += 1;
        }
      }
      return storms;
    });
  }

  const share = (counts: number[], test: (n: number) => boolean) =>
    counts.filter(test).length / counts.length;

  it.each(["Denver", "Dallas", "KansasCity", "Cordoba", "Mendoza"])(
    "usually sees zero to two damaging storms in hail alley (%s)",
    (locationId) => {
      const counts = stormCounts(locationId);
      expect(share(counts, (n) => n <= 2)).toBeGreaterThanOrEqual(0.85);
      // Still a real risk there: most runs see at least one.
      expect(share(counts, (n) => n >= 1)).toBeGreaterThan(0.5);
    },
  );

  it.each(["SF", "Seattle", "London", "Reykjavik"])(
    "usually sees none in a low-risk place (%s)",
    (locationId) => {
      expect(share(stormCounts(locationId), (n) => n === 0)).toBeGreaterThan(
        0.85,
      );
    },
  );
});
