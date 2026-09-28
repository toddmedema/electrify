import { createGame, runSimulation } from "./Simulator";
import { SCENARIOS } from "../data/Scenarios";
import { expectNoViolations } from "./SimulationTestHelpers";
import reducer, { buildFacility, sellFacility } from "../reducers/Game";
import { GENERATORS } from "../data/Facilities";
import { getMissionStatus } from "../helpers/MissionStatus";
import { scenarioObjectiveFailure } from "../helpers/ObjectiveRules";

it.each([true, false])(
  "cancelling construction removes investment credit (financed: %s)",
  (financed) => {
    const game = createGame({ scenarioId: 100 });
    const facility = GENERATORS(game, 100000000, [], []).find(
      (f) => f.gasCycle === "simple",
    )!;
    const built = reducer(game, buildFacility({ facility, financed }));
    const added = built.facilities.find(
      (f) => !game.facilities.some((old) => old.id === f.id),
    )!;
    expect(added.yearsToBuildLeft).toBeGreaterThan(0);
    expect(
      getMissionStatus(built).requirements.find((r) => r.id === "investment")
        ?.status,
    ).toBe("completed");
    const cancelled = reducer(built, sellFacility(added.id));
    expect(cancelled.meaningfulDecisions).toEqual(game.meaningfulDecisions);
    expect(
      getMissionStatus(cancelled).requirements.find(
        (r) => r.id === "investment",
      )?.status,
    ).toBe("pending");
    expect(
      scenarioObjectiveFailure(
        SCENARIOS.find((s) => s.id === 100)!,
        [],
        "Employee",
        cancelled.meaningfulDecisions,
        true,
      ),
    ).toMatch(/Build or upgrade/);
  },
);

jest.setTimeout(120000);
const classics = SCENARIOS.filter((s) => s.requiresGridInvestment);
it.each(classics)(
  "$name rejects price-only play even with the general decision gate waived",
  (scenario) => {
    expect(scenario.minimumCustomerRetention).toBe(0.8);
    for (const multiple of [1.1, 1.5, 3]) {
      const run = runSimulation({
        scenarioId: scenario.id,
        difficulty: "Employee",
        dollarsPerkWh: scenario.dollarsPerkWh * multiple,
        waiveDecisionGate: true,
      });
      expectNoViolations(run);
      expect(run.outcome).not.toBe("completed");
    }
  },
);
