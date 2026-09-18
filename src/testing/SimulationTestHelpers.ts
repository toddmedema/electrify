import cloneDeep from "lodash.clonedeep";
import { SCENARIO_CHOICES } from "../data/ScenarioChoices";
import { SCENARIOS } from "../data/Scenarios";
import { pendingScenarioChoice } from "../helpers/ScenarioChoices";
import reducer, { tickState } from "../reducers/Game";
import { chooseScenarioResponse } from "../reducers/GameActions";
import { GameType } from "../Types";
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
  if (!Number.isSafeInteger(months) || months < 0) {
    throw new Error("Simulation months must be a non-negative safe integer");
  }
  const until = state.date.monthsElapsed + months;
  while (state.date.monthsElapsed < until) {
    const decision = pendingScenarioChoice(state);
    if (decision && !state.replayPlayback) {
      const option = decision.options.find(
        (option) => option.cost(state.difficulty) === 0,
      );
      if (!option) {
        throw new Error(`Simulation has no free response for ${decision.id}`);
      }
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
    const previousMinute = state.date.minute;
    tickState(state);
    if (state.date.minute <= previousMinute) {
      throw new Error(
        `Simulation stopped advancing at month ${state.date.monthsElapsed}`,
      );
    }
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
