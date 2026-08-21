import { SCENARIOS } from "../data/Scenarios";
import { DifficultyType, ScenarioType } from "../Types";
import { createGame, runSimulation, SimResultType } from "./Simulator";
import { TICKS_PER_MONTH } from "../Constants";
import { getTimeFromTimeline } from "../helpers/DateTime";
import { tickState } from "../reducers/Game";

jest.setTimeout(120000);

function describeViolations(result: SimResultType): string {
  return result.violations
    .map((v) => `\n  [${v.rule}] ${v.when}: ${v.detail}`)
    .join("");
}

function expectNoViolations(result: SimResultType) {
  expect(
    `${result.violationCount} violations${describeViolations(result)}`,
  ).toBe("0 violations");
}

describe("simulation invariants", () => {
  // Two years is long enough to cover a full weather cycle, construction finishing and loans
  // amortizing, while keeping the whole suite well under a second per scenario
  const MONTHS = 24;

  SCENARIOS.forEach((scenario: ScenarioType) => {
    it(`holds for "${scenario.name}"`, () => {
      expectNoViolations(
        runSimulation({
          scenarioId: scenario.id,
          months: Math.min(MONTHS, scenario.durationMonths),
        }),
      );
    });
  });

  it("holds while building facilities on credit", () => {
    expectNoViolations(
      runSimulation({
        scenarioId: 103, // The Shale Boom -- 20 years, enough room to build repeatedly
        months: 60,
        strategy: "keepUp",
      }),
    );
  });

  it("holds while spending on marketing", () => {
    expectNoViolations(
      runSimulation({
        scenarioId: 101,
        months: MONTHS,
        monthlyMarketingSpend: 5000000,
      }),
    );
  });

  (["Intern", "CEO"] as DifficultyType[]).forEach((difficulty) => {
    it(`holds on ${difficulty} difficulty`, () => {
      expectNoViolations(
        runSimulation({ scenarioId: 103, months: MONTHS, difficulty }),
      );
    });
  });

  it("holds across a full 20 year run", () => {
    expectNoViolations(runSimulation({ scenarioId: 102, strategy: "keepUp" }));
  });
});

describe("simulation determinism", () => {
  // Weather, fuel prices and the tick loop all keep module level state. A run that isn't purely a
  // function of its seed means one of them is leaking between games, which would also mean a
  // player's second playthrough silently differs from their first.
  it("produces identical runs for the same seed", () => {
    const options = { scenarioId: 101, months: 24, seed: 777 };
    const first = runSimulation(options);
    const second = runSimulation(options);
    expect(second.months).toEqual(first.months);
    expect(second.finalCash).toEqual(first.finalCash);
  });

  // The seed only feeds the extrapolation past the end of the recorded data (weather runs
  // 1980-2019, fuel prices similar). Inside that window the game replays real history, so two
  // seeds legitimately agree; past it they have to diverge or the seed is being ignored.
  it("produces different runs for different seeds once past the recorded data", () => {
    // Carbon Fee starts in 2020, so every tick is extrapolated
    const first = runSimulation({ scenarioId: 100, months: 24, seed: 1 });
    const second = runSimulation({ scenarioId: 100, months: 24, seed: 2 });
    expect(second.months).not.toEqual(first.months);
  });

  it("replays recorded history identically whatever the seed", () => {
    // Rise of Renewables starts in 2002 and only runs 12 years, well inside the data
    const first = runSimulation({ scenarioId: 101, months: 24, seed: 1 });
    const second = runSimulation({ scenarioId: 101, months: 24, seed: 2 });
    expect(second.months).toEqual(first.months);
  });

  it("is unaffected by an unrelated run in between", () => {
    const options = { scenarioId: 101, months: 24, seed: 777 };
    const first = runSimulation(options);
    runSimulation({ scenarioId: 104, months: 12, seed: 999 });
    expect(runSimulation(options).months).toEqual(first.months);
  });
});

describe("simulation economics", () => {
  it("bills every customer it supplies at the going rate", () => {
    const result = runSimulation({
      scenarioId: 101,
      months: 12,
      dollarsPerkWh: 0.1,
    });
    // The first month summarizes the timeline initGame built, before the rate was overridden --
    // the same way a player's history keeps whatever rate was in force when it was recorded
    expect(result.months.length).toBeGreaterThan(2);
    result.months.slice(1).forEach((m) => {
      expect(m.revenue / (m.supplyWh / 1000)).toBeCloseTo(0.1, 6);
    });
  });

  it("starts at the rate its scenario advertises", () => {
    const result = runSimulation({ scenarioId: 101, months: 6 });
    const scenarioRate = result.scenario.dollarsPerkWh;
    result.months.forEach((m) => {
      expect(m.revenue / (m.supplyWh / 1000)).toBeCloseTo(scenarioRate, 6);
    });
  });

  it("charges more for the same electricity at a higher rate", () => {
    const cheap = runSimulation({
      scenarioId: 101,
      months: 12,
      dollarsPerkWh: 0.05,
    });
    const pricey = runSimulation({
      scenarioId: 101,
      months: 12,
      dollarsPerkWh: 0.1,
    });
    const revenue = (r: SimResultType) =>
      r.months.reduce((a, m) => a + m.revenue, 0);
    expect(revenue(pricey)).toBeGreaterThan(revenue(cheap));
  });

  /**
   * This used to run scenario 5 and assert zero emissions only `if` that run's fleet turned out
   * to be renewables-only. Scenario 5 starts on a 450MW coal plant, so the condition was never
   * true and the assertion never ran. Build the fleet the test wants rather than hoping a
   * scenario supplies one.
   */
  it("emits nothing when only renewables are running", () => {
    // Paradise is the one scenario that starts with both wind and solar
    const state = createGame({ scenarioId: 105 });
    state.facilities = state.facilities.filter(
      (f) => f.fuel === "Sun" || f.fuel === "Wind",
    );
    expect(state.facilities.length).toBeGreaterThan(0);

    let generatedW = 0;
    let kgco2e = 0;
    for (let i = 0; i < TICKS_PER_MONTH; i++) {
      tickState(state);
      const now = getTimeFromTimeline(state.date.minute, state.timeline);
      if (now) {
        generatedW += now.supplyW;
        kgco2e += now.kgco2e;
      }
    }

    // Without this the test would also pass on a fleet that never generated anything
    expect(generatedW).toBeGreaterThan(0);
    expect(kgco2e).toBe(0);
  });

  it("keeps the carbon fee proportional to emissions", () => {
    // Carbon Fee is the one scenario that starts with a non-zero feePerKgCO2e
    const result = runSimulation({ scenarioId: 100, months: 24 });
    const fee = result.scenario.feePerKgCO2e;
    expect(fee).toBeGreaterThan(0);
    result.months.forEach((m) => {
      expect(m.expensesCarbonFee).toBeCloseTo(m.kgco2e * fee, 4);
    });
  });
});
