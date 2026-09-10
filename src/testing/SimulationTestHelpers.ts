import cloneDeep from "lodash.clonedeep";
import { pendingScenarioChoice } from "../helpers/ScenarioChoices";
import reducer, { tickState } from "../reducers/Game";
import { chooseScenarioResponse } from "../reducers/GameActions";
import { GameType } from "../Types";
import { SimResultType } from "./Simulator";

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
