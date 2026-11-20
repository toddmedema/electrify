import {
  expansionEconomicsPlay,
  STANDARD_BALANCE_PLAYS,
} from "./BalancePlaybooks";
import {
  ECONOMICS_SCENARIOS,
  expectNoViolations,
} from "./SimulationTestHelpers";
import { runSimulation } from "./Simulator";

jest.setTimeout(120000);

// The economics matrix is split across SimulationEconomics*.sim.test.tsx so that Jest, which
// runs files rather than tests in parallel, can spread its long simulations over every CI core.
describe("simulation economics on CEO across seeds", () => {
  for (const seed of [1, 7, 20])
    ECONOMICS_SCENARIOS.forEach((scenario) =>
      it(`wins the ten-decision playbook in "${scenario.name}" on representative seed ${seed}`, () => {
        const active = runSimulation({
          scenarioId: scenario.id,
          difficulty: "CEO",
          seed,
          ...(scenario.id === 116
            ? expansionEconomicsPlay(seed)
            : STANDARD_BALANCE_PLAYS[scenario.id]),
        });
        expectNoViolations(active);
        expect([
          scenario.id,
          active.meaningfulDecisionCount,
          active.meaningfulDecisionCategoryCount >=
            (scenario.id === 116 ? 2 : 4),
          active.outcome,
        ]).toEqual([scenario.id, 10, true, "completed"]);
      }),
    );
});
