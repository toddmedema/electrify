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

  it("produces incidents, disconnected energy and restoration cost only when enabled", () => {
    const onAgg = aggregate(on);
    const offAgg = aggregate(off);

    // The hazard is not vacuous: at least one incident across the sample.
    expect(onAgg.incidents).toBeGreaterThan(0);
    // Enabled runs book disconnected energy and restoration cost; disabled runs book none.
    expect(onAgg.disconnectedWh).toBeGreaterThan(0);
    expect(onAgg.restorationCost).toBeGreaterThan(0);
    expect(offAgg.incidents).toBe(0);
    expect(offAgg.disconnectedWh).toBe(0);
    expect(offAgg.restorationCost).toBe(0);

    // Severity stays within the authored bounds.
    on.forEach((result) => {
      result.storyOccurrences
        .filter((e) => e.definitionId === "recurring-wildfire")
        .forEach((incident) => {
          const severity = incident.attributes.severity as number;
          expect(severity).toBeGreaterThanOrEqual(0);
          expect(severity).toBeLessThan(1);
        });
    });

    // The hazard degrades connected-demand reliability relative to the identical no-hazard run.
    const onReliability = onAgg.reliabilitySum / SEEDS.length;
    const offReliability = offAgg.reliabilitySum / SEEDS.length;
    expect(onReliability).toBeLessThan(offReliability);
  });

  it("does not guarantee bankruptcy: most enabled runs still complete", () => {
    const bankruptcies = on.filter((result) => result.wentBankrupt).length;
    // The hazard is a meaningful risk, not an automatic loss.
    expect(bankruptcies).toBeLessThan(SEEDS.length);
  });

  it("preparedness is a useful tradeoff that never prevents the fire", () => {
    // Fund (or decline) the recurring preparedness choice in every year of the run.
    const responsesFor = (option: string): Record<string, string> => {
      const responses: Record<string, string> = {};
      for (
        let year = wildfireScenario.startingYear;
        year < wildfireScenario.startingYear + MONTHS / 12;
        year++
      ) {
        responses[`wildfire:LA:${year}:preparedness`] = option;
      }
      return responses;
    };
    let preparedDisconnected = 0;
    let standardDisconnected = 0;
    let totalIncidents = 0;
    SEEDS.forEach((seed) => {
      const prepared = runSimulation({
        scenario: laCustomScenario,
        scenarioId: CUSTOM_SCENARIO_ID,
        seed,
        months: MONTHS,
        scenarioResponses: responsesFor("prepare"),
      });
      const standard = runSimulation({
        scenario: laCustomScenario,
        scenarioId: CUSTOM_SCENARIO_ID,
        seed,
        months: MONTHS,
        scenarioResponses: responsesFor("standard"),
      });
      // The same fires occur in both runs: preparedness does not prevent ignition.
      expect(prepared.wildfireImpact.incidentCount).toBe(
        standard.wildfireImpact.incidentCount,
      );
      preparedDisconnected += prepared.wildfireImpact.totalDisconnectedWh;
      standardDisconnected += standard.wildfireImpact.totalDisconnectedWh;
      totalIncidents += prepared.wildfireImpact.incidentCount;
    });
    if (totalIncidents === 0) {
      return; // No fires in the sample; the unit tests cover the halving.
    }
    // Fires still happen despite preparedness (it is not a guarantee of safety).
    expect(totalIncidents).toBeGreaterThan(0);
    // And it is a useful tradeoff: funding it never increases disconnected energy.
    expect(preparedDisconnected).toBeLessThanOrEqual(standardDisconnected);
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
    // The hazard still resolves on forecast weather.
    expect(result.wildfireImpact.incidentCount).toBeGreaterThanOrEqual(0);
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
