import { INTERN_ONE_BUILD_PLAYS } from "./BalancePlaybooks";
import { expectNoViolations } from "./SimulationTestHelpers";
import { runSimulation } from "./Simulator";

// Register the unchanged seed sweep in separate files so Jest can schedule both scenarios.
export function registerInternSeedTests(scenarioId: number) {
  it.each([scenarioId])(
    "keeps Intern scenario %s one-build playbooks viable across seeds 1-20",
    (scenarioId) => {
      for (let seed = 1; seed <= 20; seed++) {
        const passive = runSimulation({
          scenarioId,
          difficulty: "Intern",
          seed,
        });
        const active = runSimulation({
          scenarioId,
          difficulty: "Intern",
          seed,
          ...INTERN_ONE_BUILD_PLAYS[scenarioId],
        });
        expectNoViolations(passive);
        expectNoViolations(active);
        expect(passive.meaningfulDecisionCount).toBeLessThanOrEqual(1);
        expect([seed, active.outcome]).toEqual([seed, "completed"]);
        expect(active.meaningfulDecisionCount).toBe(1);
      }
    },
  );
}
