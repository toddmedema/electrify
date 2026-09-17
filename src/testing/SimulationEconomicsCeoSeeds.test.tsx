import { STANDARD_BALANCE_PLAYS } from "./BalancePlaybooks";
import {
  ECONOMICS_SCENARIOS,
  expectNoViolations,
} from "./SimulationTestHelpers";
import { runSimulation } from "./Simulator";

jest.setTimeout(120000);

// The economics matrix is split across SimulationEconomics*.test.tsx so that Jest, which runs
// files rather than tests in parallel, can spread its long simulations over every CI core.
describe("simulation economics on CEO across seeds", () => {
  it.each([1, 7, 20])(
    "wins all CEO playbooks with ten decisions on representative seed %s",
    (seed) => {
      ECONOMICS_SCENARIOS.forEach((scenario) => {
        const active = runSimulation({
          scenarioId: scenario.id,
          difficulty: "CEO",
          seed,
          ...STANDARD_BALANCE_PLAYS[scenario.id],
        });
        expectNoViolations(active);
        expect([
          scenario.id,
          active.meaningfulDecisionCount,
          active.meaningfulDecisionCategoryCount >= 4,
          active.outcome,
        ]).toEqual([scenario.id, 10, true, "completed"]);
      });
    },
  );
});
