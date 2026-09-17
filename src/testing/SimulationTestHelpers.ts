import cloneDeep from "lodash.clonedeep";
import { SCENARIO_CHOICES } from "../data/ScenarioChoices";
import { SCENARIOS } from "../data/Scenarios";
import { pendingScenarioChoice } from "../helpers/ScenarioChoices";
import reducer, { tickState } from "../reducers/Game";
import { chooseScenarioResponse } from "../reducers/GameActions";
import { GameType } from "../Types";
import { STANDARD_BALANCE_PLAYS } from "./BalancePlaybooks";
import { runSimulation, SimOptionsType, SimResultType } from "./Simulator";

/** The scored scenarios the economics suites play; tutorials have their own coverage. */
export const ECONOMICS_SCENARIOS = SCENARIOS.filter(
  (scenario) => !scenario.tutorialSteps,
);

// Mandatory baseline responses are recorded actions; a binding connection also earns credit.
export function baselineChoiceActions(
  result: SimResultType,
  scenarioId: number,
) {
  return SCENARIO_CHOICES.filter(
    (choice) =>
      choice.scenarioId === scenarioId && choice.atMonth < result.months.length,
  ).length;
}

export function baselineMeaningfulChoices(
  scenarioId: number,
  result?: SimResultType,
) {
  return SCENARIO_CHOICES.filter(
    (choice) =>
      choice.scenarioId === scenarioId &&
      (!result || choice.atMonth < result.months.length) &&
      choice.options.find((option) => option.cost("Intern") === 0)
        ?.meaningful !== false,
  ).length;
}

/**
 * Registers one test per choice in a scenario's CEO playbook, each proving the plan fails with
 * that choice left out. Shared so the long matrix can be split across files Jest runs in parallel.
 */
export function describeCeoOmissions(scenarioIds: number[]) {
  scenarioIds.forEach((scenarioId) => {
    const play = STANDARD_BALANCE_PLAYS[scenarioId];
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

    if (omissions.length + baselineMeaningfulChoices(scenarioId) !== 10) {
      throw new Error(
        `CEO ${scenarioId} play must total ten choices including mandatory responses`,
      );
    }
    omissions.forEach((omission, index) => {
      it(`rejects actual CEO ${scenarioId} plan with choice ${index + 1} removed`, () => {
        const shortened = runSimulation({
          scenarioId,
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
}

/**
 * runSimulation, remembering each result for the rest of the test file. Runs are a pure function
 * of their options, so tests in one file that need the same playthrough share a single run.
 * Callers must treat the result as read-only.
 */
const simulationResults = new Map<string, SimResultType>();
export function runSimulationOnce(options: SimOptionsType): SimResultType {
  // Sorted keys, so the same options spread in a different order still share a run
  const key = JSON.stringify(options, (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : value,
  );
  let result = simulationResults.get(key);
  if (!result) {
    result = runSimulation(options);
    simulationResults.set(key, result);
  }
  return result;
}

export function runMonths(state: GameType, months: number) {
  const until = state.date.monthsElapsed + months;
  while (state.date.monthsElapsed < until) {
    const decision = pendingScenarioChoice(state);
    if (decision && !state.replayPlayback) {
      const option = decision.options.find(
        (option) => option.cost(state.difficulty) === 0,
      )!;
      Object.assign(
        state,
        cloneDeep(
          reducer(
            cloneDeep(state),
            chooseScenarioResponse({
              decisionId: decision.id,
              optionId: option.id,
            }),
          ),
        ),
      );
    }
    tickState(state);
  }
}

function describeViolations(result: SimResultType): string {
  return result.violations
    .map((v) => `\n  [${v.rule}] ${v.when}: ${v.detail}`)
    .join("");
}

export function expectNoViolations(result: SimResultType) {
  expect(
    `${result.violationCount} violations${describeViolations(result)}`,
  ).toBe("0 violations");
}
