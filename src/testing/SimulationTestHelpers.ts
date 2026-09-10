import { GameType } from "../Types";
import { SimResultType } from "./Simulator";
import { tickState } from "../reducers/Game";

// Advance the real game state for tests that inspect the resulting save, replay, or dispatch.
export function runMonths(state: GameType, months: number) {
  const until = state.date.monthsElapsed + months;
  while (state.date.monthsElapsed < until) {
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
