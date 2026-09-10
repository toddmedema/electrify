import { SCENARIOS } from "../data/Scenarios";
import { createGame, runSimulation, SimResultType } from "./Simulator";
import {
  INTERN_ONE_BUILD_PLAYS,
  STANDARD_BALANCE_PLAYS,
} from "./BalancePlaybooks";
import { TICKS_PER_MONTH } from "../Constants";
import { getTimeFromTimeline } from "../helpers/DateTime";
import { tickState } from "../reducers/Game";
import { expectNoViolations } from "./SimulationTestHelpers";

jest.setTimeout(120000);

describe("simulation economics", () => {
  SCENARIOS.filter(
    (scenario) => !scenario.tutorialSteps && scenario.id < 106,
  ).forEach((scenario) => {
    it(`fails passively but needs only one build on Intern in "${scenario.name}"`, () => {
      const passive = runSimulation({
        scenarioId: scenario.id,
        difficulty: "Intern",
      });
      expectNoViolations(passive);
      expect(passive.actionCount).toBe(0);
      expect(passive.outcome).not.toBe("completed");

      const active = runSimulation({
        scenarioId: scenario.id,
        difficulty: "Intern",
        ...INTERN_ONE_BUILD_PLAYS[scenario.id],
      });
      expectNoViolations(active);
      expect(active.actionCount).toBe(1);
      expect(active.builds).toHaveLength(1);
      expect(active.outcome).toBe("completed");
    });
  });

  SCENARIOS.filter((scenario) => [108, 110].includes(scenario.id)).forEach(
    (scenario) => {
      it(`requires player input but accepts one build on Intern in "${scenario.name}"`, () => {
        const passive = runSimulation({
          scenarioId: scenario.id,
          difficulty: "Intern",
        });
        expectNoViolations(passive);
        expect(passive.actionCount).toBe(0);
        expect(passive.outcome).not.toBe("completed");

        const active = runSimulation({
          scenarioId: scenario.id,
          difficulty: "Intern",
          ...INTERN_ONE_BUILD_PLAYS[scenario.id],
        });
        expectNoViolations(active);
        expect(active.actionCount).toBe(1);
        expect(active.builds).toHaveLength(1);
        expect(active.outcome).toBe("completed");
      });
    },
  );

  SCENARIOS.filter(
    (scenario) => !scenario.tutorialSteps && scenario.id < 106,
  ).forEach((scenario) => {
    it(`rejects passive play and accepts a multi-action plan in "${scenario.name}" on CEO`, () => {
      const passive = runSimulation({
        scenarioId: scenario.id,
        difficulty: "CEO",
      });
      expectNoViolations(passive);
      expect(passive.actionCount).toBe(0);
      expect(passive.outcome).not.toBe("completed");

      const play = STANDARD_BALANCE_PLAYS[scenario.id];
      const active = runSimulation({
        scenarioId: scenario.id,
        difficulty: "CEO",
        ...play,
      });
      expectNoViolations(active);
      expect(active.actionCount).toBeGreaterThanOrEqual(3);
      expect(active.outcome).toBe("completed");
    });
  });

  it("makes a replacement build necessary at the End of an Era compliance deadline", () => {
    const shortcut = runSimulation({
      scenarioId: 102,
      difficulty: "CEO",
      dollarsPerkWh: 0.15,
      sellFacilityId: 1,
      sellAtMonth: 39,
    });
    expectNoViolations(shortcut);
    expect(shortcut.actionCount).toBe(2);
    expect(shortcut.outcome).not.toBe("completed");
  });

  it("makes storm hardening necessary on Hurricane Season CEO", () => {
    const shortcut = runSimulation({
      scenarioId: 104,
      difficulty: "CEO",
      dollarsPerkWh: 0.08,
    });
    expectNoViolations(shortcut);
    expect(shortcut.actionCount).toBe(1);
    expect(shortcut.outcome).not.toBe("completed");
  });

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

  it("moves investor customers toward a cheaper utility and away from a dearer one", () => {
    const customersAt = (dollarsPerkWh: number) =>
      runSimulation({ scenarioId: 101, months: 12, dollarsPerkWh }).months.at(
        -1,
      )!.customers;
    expect(customersAt(0.05)).toBeGreaterThan(customersAt(0.07));
    expect(customersAt(0.07)).toBeGreaterThan(customersAt(0.1));
  });

  it("keeps public customer growth independent of the rate", () => {
    const customersAt = (dollarsPerkWh: number) =>
      runSimulation({ scenarioId: 104, months: 12, dollarsPerkWh }).months.at(
        -1,
      )!.customers;
    expect(customersAt(0.02)).toBe(customersAt(0.2));
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
