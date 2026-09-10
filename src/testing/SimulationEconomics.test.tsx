import { TICKS_PER_MONTH } from "../Constants";
import { SCENARIO_CHOICES } from "../data/ScenarioChoices";
import { SCENARIOS } from "../data/Scenarios";
import { getTimeFromTimeline } from "../helpers/DateTime";
import { tickState } from "../reducers/Game";
import { MeaningfulDecisionKindType } from "../Types";
import {
  INTERN_ONE_BUILD_PLAYS,
  STANDARD_BALANCE_PLAYS,
} from "./BalancePlaybooks";
import { expectNoViolations } from "./SimulationTestHelpers";
import {
  createGame,
  runSimulation,
  SimOptionsType,
  SimResultType,
} from "./Simulator";

jest.setTimeout(120000);

// Mandatory baseline responses are recorded actions; a binding connection also earns credit.
function baselineChoiceActions(result: SimResultType, scenarioId: number) {
  return SCENARIO_CHOICES.filter(
    (choice) =>
      choice.scenarioId === scenarioId && choice.atMonth < result.months.length,
  ).length;
}

function baselineMeaningfulChoices(scenarioId: number, result?: SimResultType) {
  return SCENARIO_CHOICES.filter(
    (choice) =>
      choice.scenarioId === scenarioId &&
      (!result || choice.atMonth < result.months.length) &&
      choice.options.find((option) => option.cost("Intern") === 0)
        ?.meaningful !== false,
  ).length;
}

describe("simulation economics", () => {
  const scenarios = SCENARIOS.filter((scenario) => !scenario.tutorialSteps);
  const expectedCeoCategories: Record<number, MeaningfulDecisionKindType[]> = {
    100: [
      "asset",
      "dispatch",
      "operation",
      "policy",
      "rate",
      "sale",
      "trading",
    ],
    101: ["asset", "dispatch", "operation", "rate", "sale"],
    102: ["asset", "dispatch", "operation", "rate", "sale"],
    103: ["asset", "dispatch", "operation", "rate", "sale"],
    104: ["asset", "dispatch", "operation", "policy", "rate", "sale"],
    105: ["asset", "dispatch", "operation", "policy", "rate", "sale"],
    106: ["asset", "dispatch", "policy", "rate", "sale", "trading"],
    107: ["asset", "dispatch", "operation", "policy", "rate"],
    108: ["asset", "dispatch", "operation", "policy", "rate", "trading"],
    110: ["asset", "dispatch", "operation", "policy", "rate", "trading"],
    111: ["asset", "dispatch", "operation", "policy", "rate", "trading"],
  };
  scenarios.forEach((scenario) => {
    it(`fails passively but needs only one build on Intern in "${scenario.name}"`, () => {
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
      expect(passive.outcome).not.toBe("completed");

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

  scenarios.forEach((scenario) => {
    it(`requires ten validated decisions in "${scenario.name}" on CEO`, () => {
      const passive = runSimulation({
        scenarioId: scenario.id,
        difficulty: "CEO",
      });
      expectNoViolations(passive);
      expect(passive.actionCount).toBe(
        baselineChoiceActions(passive, scenario.id),
      );
      expect(passive.meaningfulDecisionCount).toBe(
        baselineMeaningfulChoices(scenario.id, passive),
      );
      expect(passive.outcome).not.toBe("completed");

      const play = STANDARD_BALANCE_PLAYS[scenario.id];
      const active = runSimulation({
        scenarioId: scenario.id,
        difficulty: "CEO",
        ...play,
      });
      expectNoViolations(active);
      expect([
        active.meaningfulDecisionCount,
        active.meaningfulDecisionCategoryCount >= 4,
        new Set(active.meaningfulDecisionKeys).size,
        active.outcome,
        active.meaningfulDecisionLabels,
      ]).toEqual([10, true, 10, "completed", expect.any(Array)]);
      expect(active.meaningfulDecisionCategories).toEqual(
        expectedCeoCategories[scenario.id],
      );
    });
  });

  it.each([107, 111])(
    "keeps Intern scenario %s passive-fail / one-build-win across seeds 1-20",
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
        expect([seed, passive.outcome]).not.toEqual([seed, "completed"]);
        expect([seed, active.outcome]).toEqual([seed, "completed"]);
        expect(active.meaningfulDecisionCount).toBe(1);
      }
    },
  );

  it.each([1, 7, 20])(
    "wins all CEO playbooks with ten decisions on representative seed %s",
    (seed) => {
      scenarios.forEach((scenario) => {
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

  scenarios.forEach((scenario) => {
    const play = STANDARD_BALANCE_PLAYS[scenario.id];
    const omissions: Array<Partial<SimOptionsType>> = (
      play.scheduledActions || []
    ).map((_action, omitted) => ({
      scheduledActions: play.scheduledActions!.filter(
        (_candidate, index) => index !== omitted,
      ),
    }));
    if (play.initialBuild) omissions.push({ initialBuild: undefined });
    if (play.sellFacilityId !== undefined)
      omissions.push({ sellFacilityId: undefined });

    if (omissions.length + baselineMeaningfulChoices(scenario.id) !== 10) {
      throw new Error(
        `CEO ${scenario.id} play must total ten choices including mandatory responses`,
      );
    }
    omissions.forEach((omission, index) => {
      it(`rejects actual CEO ${scenario.id} plan with choice ${index + 1} removed`, () => {
        const shortened = runSimulation({
          scenarioId: scenario.id,
          difficulty: "CEO",
          ...play,
          ...omission,
        });
        expectNoViolations(shortened);
        expect(shortened.meaningfulDecisionCount).toBeLessThan(10);
        expect(shortened.outcome).not.toBe("completed");
      });
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
