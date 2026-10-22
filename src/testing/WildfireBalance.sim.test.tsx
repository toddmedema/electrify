import { SCENARIOS, CUSTOM_SCENARIO_ID } from "../data/Scenarios";
import { ScenarioType } from "../Types";
import { runSimulation, SimResultType } from "./Simulator";

jest.setTimeout(180000);

const wildfireScenario = SCENARIOS.find((s) => s.id === 111)!;

// A custom game in the LA service area: eligible for the recurring hazard, no authored story.
const laCustomScenario: ScenarioType = {
  ...wildfireScenario,
  id: CUSTOM_SCENARIO_ID,
  name: "Custom LA",
  facilities: [{ name: "Natural Gas Peaker", peakW: 20e6 }],
};

const SEEDS = [101, 202, 303, 404, 505, 606];
const MONTHS = 12 * 10; // Ten years: enough incidents for a stable comparison, fast to run.

function averageReliability(result: SimResultType): number {
  if (!result.months.length) return 1;
  const total = result.months.reduce((sum, month) => {
    if (month.demandWh <= 0) return sum;
    return sum + Math.min(1, month.supplyWh / month.demandWh);
  }, 0);
  return total / result.months.length;
}

function aggregate(results: SimResultType[]) {
  return results.reduce(
    (acc, result) => {
      acc.incidents += result.wildfireImpact.incidentCount;
      acc.disconnectedWh += result.wildfireImpact.totalDisconnectedWh;
      acc.restorationCost += result.wildfireImpact.totalRestorationCost;
      acc.bankruptcies += result.wentBankrupt ? 1 : 0;
      acc.violations += result.violationCount;
      acc.reliabilitySum += averageReliability(result);
      return acc;
    },
    {
      incidents: 0,
      disconnectedWh: 0,
      restorationCost: 0,
      bankruptcies: 0,
      violations: 0,
      reliabilitySum: 0,
    },
  );
}

// The expensive runs are computed once and shared across assertions.
let on: SimResultType[] = [];
let off: SimResultType[] = [];

beforeAll(() => {
  on = SEEDS.map((seed) =>
    runSimulation({
      scenario: laCustomScenario,
      scenarioId: CUSTOM_SCENARIO_ID,
      seed,
      months: MONTHS,
    }),
  );
  off = SEEDS.map((seed) =>
    runSimulation({
      scenario: laCustomScenario,
      scenarioId: CUSTOM_SCENARIO_ID,
      seed,
      months: MONTHS,
      wildfireHazardEnabled: false,
    }),
  );
});

describe("recurring wildfire hazard balance (many seeds, real reducer)", () => {
  it("runs clean (no invariant violations) with the hazard on and off", () => {
    on.forEach((result) => expect(result.violationCount).toBe(0));
    off.forEach((result) => expect(result.violationCount).toBe(0));
  });

  it("replays observed smoke without inventing outages, repair bills or gas derates", () => {
    const onAgg = aggregate(on);
    const offAgg = aggregate(off);

    // The hazard is not vacuous: at least one incident across the sample.
    expect(onAgg.incidents).toBeGreaterThan(0);
    // Overhead smoke alone establishes neither disconnected load nor physical damage.
    expect(onAgg.disconnectedWh).toBe(0);
    expect(onAgg.restorationCost).toBe(0);
    expect(offAgg.incidents).toBe(0);
    expect(offAgg.disconnectedWh).toBe(0);
    expect(offAgg.restorationCost).toBe(0);

    on.forEach((result, index) => {
      const incidents = result.storyOccurrences.filter(
        (e) => e.definitionId === "wildfire-smoke",
      );
      incidents.forEach((incident) => {
        expect(incident.attributes.heavySmokeDays).toBeGreaterThan(0);
        expect(Object.keys(incident.effects)).toEqual([
          "solarIrradianceMultipliersByHour",
        ]);
      });
      // The same non-solar fleet has exactly the same service and finances over ten years.
      const flows = (result: SimResultType) =>
        result.months.map(({ chartAverage: _chartAverage, ...month }) => month);
      expect(flows(result)).toEqual(flows(off[index]));
    });
  });

  it("does not guarantee bankruptcy: most enabled runs still complete", () => {
    const bankruptcies = on.filter((result) => result.wentBankrupt).length;
    // The hazard is a meaningful risk, not an automatic loss.
    expect(bankruptcies).toBeLessThan(SEEDS.length);
  });

  it("runs a start beyond the recorded weather window without error", () => {
    const futureScenario: ScenarioType = {
      ...laCustomScenario,
      startingYear: 2080,
    };
    const result = runSimulation({
      scenario: futureScenario,
      scenarioId: CUSTOM_SCENARIO_ID,
      seed: 7,
      months: MONTHS,
    });
    expect(result.violationCount).toBe(0);
  });

  it("applies no inferred risk to an unprofiled location", () => {
    const pitScenario = SCENARIOS.find((s) => s.id === 103)!; // Pittsburgh
    const pitCustom: ScenarioType = {
      ...pitScenario,
      id: CUSTOM_SCENARIO_ID,
      name: "Custom PIT",
    };
    const result = runSimulation({
      scenario: pitCustom,
      scenarioId: CUSTOM_SCENARIO_ID,
      seed: 7,
      months: MONTHS,
    });
    expect(result.violationCount).toBe(0);
    // No profile, no hazard: zero incidents and no disconnected energy.
    expect(result.wildfireImpact.incidentCount).toBe(0);
    expect(result.wildfireImpact.totalDisconnectedWh).toBe(0);
  });
});
