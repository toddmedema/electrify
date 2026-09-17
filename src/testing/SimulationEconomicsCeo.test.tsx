import { MeaningfulDecisionKindType } from "../Types";
import { STANDARD_BALANCE_PLAYS } from "./BalancePlaybooks";
import {
  baselineChoiceActions,
  baselineMeaningfulChoices,
  describeCeoOmissions,
  ECONOMICS_SCENARIOS,
  expectNoViolations,
} from "./SimulationTestHelpers";
import { runSimulation } from "./Simulator";

jest.setTimeout(120000);

// The economics matrix is split across SimulationEconomics*.test.tsx so that Jest, which runs
// files rather than tests in parallel, can spread its long simulations over every CI core.
describe("simulation economics on CEO", () => {
  const expectedCeoCategories: Record<number, MeaningfulDecisionKindType[]> = {
    100: [
      "asset",
      "dispatch",
      "operation",
      "policy",
      "rate",
      "sale",
      "trading",
    ],
    101: ["asset", "dispatch", "operation", "rate", "sale"],
    102: ["asset", "dispatch", "operation", "rate", "sale"],
    103: ["asset", "dispatch", "operation", "rate", "sale"],
    104: ["asset", "dispatch", "operation", "policy", "rate", "sale"],
    105: ["asset", "dispatch", "operation", "policy", "rate", "sale"],
    106: ["asset", "dispatch", "policy", "rate", "sale", "trading"],
    107: ["asset", "dispatch", "operation", "policy", "rate"],
    108: ["asset", "dispatch", "operation", "policy", "rate", "trading"],
    110: ["asset", "dispatch", "operation", "policy", "rate", "trading"],
    111: ["asset", "dispatch", "operation", "policy", "rate", "trading"],
    113: ["asset", "dispatch", "operation", "policy", "rate", "trading"],
    114: ["asset", "dispatch", "operation", "policy", "rate", "trading"],
    115: ["asset", "dispatch", "operation", "policy", "rate", "trading"],
  };
  ECONOMICS_SCENARIOS.forEach((scenario) => {
    it(`requires ten validated decisions in "${scenario.name}" on CEO`, () => {
      const passive = runSimulation({
        scenarioId: scenario.id,
        difficulty: "CEO",
      });
      expectNoViolations(passive);
      expect(passive.actionCount).toBe(
        baselineChoiceActions(passive, scenario.id),
      );
      expect(passive.meaningfulDecisionCount).toBe(
        baselineMeaningfulChoices(scenario.id, passive),
      );
      expect(passive.outcome).not.toBe("completed");

      const play = STANDARD_BALANCE_PLAYS[scenario.id];
      const active = runSimulation({
        scenarioId: scenario.id,
        difficulty: "CEO",
        ...play,
      });
      expectNoViolations(active);
      expect([
        active.meaningfulDecisionCount,
        active.meaningfulDecisionCategoryCount >= 4,
        new Set(active.meaningfulDecisionKeys).size,
        active.outcome,
        active.meaningfulDecisionLabels,
      ]).toEqual([10, true, 10, "completed", expect.any(Array)]);
      expect(active.meaningfulDecisionCategories).toEqual(
        expectedCeoCategories[scenario.id],
      );
    });
  });

  // The other half of the omission matrix is in SimulationEconomicsCeoOmissions.test.tsx
  describeCeoOmissions(
    ECONOMICS_SCENARIOS.filter((_scenario, index) => index % 2 === 0).map(
      (scenario) => scenario.id,
    ),
  );
});
