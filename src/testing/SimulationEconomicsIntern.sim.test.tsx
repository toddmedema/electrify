import { INTERN_ONE_BUILD_PLAYS } from "./BalancePlaybooks";
import {
  baselineChoiceActions,
  baselineMeaningfulChoices,
  ECONOMICS_SCENARIOS,
  expectNoViolations,
} from "./SimulationTestHelpers";
import { runSimulation } from "./Simulator";

jest.setTimeout(120000);

describe("simulation economics", () => {
  ECONOMICS_SCENARIOS.forEach((scenario) => {
    it(`validates the one-build balance playbook on Intern in "${scenario.name}"`, () => {
      const passive = runSimulation({
        scenarioId: scenario.id,
        difficulty: "Intern",
      });
      expectNoViolations(passive);
      expect(passive.actionCount).toBe(
        baselineChoiceActions(passive, scenario.id),
      );
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
      expect(active.actionCount).toBe(
        1 + baselineChoiceActions(active, scenario.id),
      );
      expect(active.meaningfulDecisionCount).toBe(
        1 + baselineMeaningfulChoices(scenario.id, active),
      );
      expect(active.builds).toHaveLength(1);
      expect(active.outcome).toBe("completed");
    });
  });
});
