import { publicRateCap } from "../helpers/Customers";
import { getScenario } from "../data/Scenarios";
import { createGame, runSimulation } from "../testing/Simulator";
import gameReducer, { delta } from "./Game";

describe("public utility board rate cap", () => {
  // Loads the economic data the inflation index reads
  beforeAll(() => createGame({ scenarioId: 104 }));

  it("caps rates at exactly twice the annual inflation-adjusted target", () => {
    const start = { year: 2000, monthNumber: 1 };
    expect(publicRateCap(0.05, start, 2000, 1)).toBeCloseTo(0.1, 10);
    expect(publicRateCap(0.01, start, 2000, 1)).toBe(0.02);
    expect(
      publicRateCap(0.05, { year: 2010, monthNumber: 1 }, 2000, 1),
    ).toBeGreaterThan(0.1);
  });

  it("caps a public scenario's rate and records the capped value", () => {
    // Hurricane Season is a public utility
    const game = createGame({ scenarioId: 104 });
    const cap = publicRateCap(
      getScenario(104)?.dollarsPerkWh ?? NaN,
      game.date,
      game.startingYear,
      game.seed,
    );
    expect(cap).toBeLessThan(0.3);
    const next = gameReducer(game, delta({ dollarsPerkWh: 0.3 }));
    expect(next.dollarsPerkWh).toBe(cap);
    expect(next.meaningfulDecisions.find((d) => d.kind === "rate")?.after).toBe(
      String(cap),
    );
    // Rates under the cap are untouched
    expect(
      gameReducer(game, delta({ dollarsPerkWh: 0.08 })).dollarsPerkWh,
    ).toBe(0.08);
  });

  it("leaves investor rates to customer competition", () => {
    const game = createGame({ scenarioId: 100 });
    expect(gameReducer(game, delta({ dollarsPerkWh: 0.2 })).dollarsPerkWh).toBe(
      0.2,
    );
  });

  it("stops a passive public utility from banking a fortune at an extreme rate", () => {
    const game = createGame({ scenarioId: 104, difficulty: "Employee" });
    const cap = publicRateCap(
      getScenario(104)?.dollarsPerkWh ?? NaN,
      game.date,
      game.startingYear,
      game.seed,
    );
    const capped = runSimulation({
      scenarioId: 104,
      difficulty: "Employee",
      months: 24,
      dollarsPerkWh: 0.5,
    });
    const atCap = runSimulation({
      scenarioId: 104,
      difficulty: "Employee",
      months: 24,
      dollarsPerkWh: cap,
    });
    expect(capped.finalCash).toBe(atCap.finalCash);
  });
});
