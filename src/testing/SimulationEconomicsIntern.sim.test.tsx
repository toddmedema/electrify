import { INTERN_ONE_BUILD_PLAYS } from "./BalancePlaybooks";
import {
  baselineMeaningfulChoices,
  ECONOMICS_SCENARIOS,
  expectNoViolations,
} from "./SimulationTestHelpers";
import { runSimulation } from "./Simulator";

jest.setTimeout(120000);

describe("simulation economics", () => {
  ECONOMICS_SCENARIOS.forEach((scenario) => {
    it(`validates the investment balance playbook on Intern in "${scenario.name}"`, () => {
      const passive = runSimulation({
        scenarioId: scenario.id,
        difficulty: "Intern",
      });
      expectNoViolations(passive);
      expect(passive.meaningfulDecisionCount).toBe(
        baselineMeaningfulChoices(scenario.id, passive),
      );
      // The internal action benchmark must not change a player outcome.
      expect(passive.meaningfulDecisionCount).toBeLessThanOrEqual(1);

      const active = runSimulation({
        scenarioId: scenario.id,
        difficulty: "Intern",
        ...INTERN_ONE_BUILD_PLAYS[scenario.id],
      });
      expectNoViolations(active);
      expect(active.meaningfulDecisionCount).toBe(
        scenario.id === 116
          ? 11
          : 1 + baselineMeaningfulChoices(scenario.id, active),
      );
      expect(active.builds).toHaveLength(scenario.id === 116 ? 6 : 1);
      expect(active.finalUtilityExpansion?.acquisitions ?? []).toHaveLength(
        scenario.id === 116 ? 1 : 0,
      );
      expect(active.meaningfulDecisionCategories).toEqual(
        scenario.id === 116 ? ["asset", "rate", "sale"] : expect.any(Array),
      );
      expect(active.outcome).toBe("completed");
    });
  });
});
