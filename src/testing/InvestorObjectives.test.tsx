import { createGame, runSimulation } from "./Simulator";
import { SCENARIOS } from "../data/Scenarios";
import { expectNoViolations } from "./SimulationTestHelpers";
import reducer, { buildFacility, sellFacility } from "../reducers/Game";
import { GENERATORS } from "../data/Facilities";

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
    const cancelled = reducer(built, sellFacility(added.id));
    expect(cancelled.meaningfulDecisions).toEqual(game.meaningfulDecisions);
  },
);

jest.setTimeout(120000);
const classics = SCENARIOS.filter((s) =>
  [100, 101, 102, 103, 105].includes(s.id),
);
it.each(classics)(
  "$name rejects extreme prices that drive customers away",
  (scenario) => {
    expect(scenario.minimumCustomerRetention).toBe(0.8);
    for (const multiple of [3]) {
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

it("allows a solvent price-only plan that retains its customers", () => {
  const run = runSimulation({
    scenarioId: 100,
    difficulty: "Employee",
    dollarsPerkWh: SCENARIOS.find((s) => s.id === 100)!.dollarsPerkWh * 1.1,
    waiveDecisionGate: true,
  });
  expectNoViolations(run);
  expect(run.outcome).toBe("completed");
});
