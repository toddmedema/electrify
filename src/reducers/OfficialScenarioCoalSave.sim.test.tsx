import "../Store";
import cloneDeep from "lodash.clonedeep";
import { TICKS_PER_MONTH } from "../Constants";
import { getScenario } from "../data/Scenarios";
import { currentTick } from "../helpers/GameSelectors";
import { runFailure } from "../helpers/ObjectiveRules";
import { validScenarioRuleState } from "../helpers/ScenarioRuleValidation";
import { scenarioRules } from "../helpers/ScenarioRules";
import { parseSave, serializeSave } from "../SaveGame";
import { STANDARD_BALANCE_PLAYS } from "../testing/BalancePlaybooks";
import { checkMonth, InvariantCollector } from "../testing/Invariants";
import { playOfficialExecution } from "../testing/OfficialScenarioExecutionFixtures";
import type { GameType } from "../Types";
import { tickState } from "./Game";
import { roundTrip } from "../testing/SaveForgery";

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

function verifyCompletedMonth(game: GameType, collector: InvariantCollector) {
  checkMonth(
    collector,
    game.monthlyHistory[0],
    String(game.date.monthsElapsed),
  );
  expect(
    runFailure(
      game,
      getScenario(102)!,
      game.monthlyHistory,
      currentTick(game)!,
      false,
    ),
  ).toBeUndefined();
}

function advance(game: GameType, month: number) {
  const collector = new InvariantCollector();
  for (
    let count = 0;
    game.date.monthsElapsed < month && count < (month + 1) * TICKS_PER_MONTH;
    count++
  ) {
    const before = game.date.monthsElapsed;
    tickState(game);
    if (before !== game.date.monthsElapsed)
      verifyCompletedMonth(game, collector);
  }
  expect(game.date.monthsElapsed).toBe(month);
  expect(collector.getViolations()).toEqual([]);
}

// The standard full-term route sells the old unit before this warning. This
// neighboring legal route retains both coal units and keeps them available,
// so save validation exercises a real nonempty historical selection.
test("operating original coal retains a nonempty warning through save/import and the later derate", () => {
  const source = STANDARD_BALANCE_PLAYS[102];
  const plan = {
    ...source,
    sellFacilityId: undefined,
    sellAtMonth: undefined,
    scheduledActions: source.scheduledActions?.filter(
      (action) => !(action.type === "toggle" && action.month === 38),
    ),
  };
  const rules = scenarioRules(getScenario(102), {
    difficulty: "CEO",
    seed: 12345,
  })!;
  const warning = rules.events.find((event) => event.id === "aging-warning")!;
  const onset = rules.events.find((event) => event.id === "aging-derate")!;
  expect(warning.startMonth + 1).toBe(49);
  expect(onset.startMonth + 1).toBe(73);
  const { game, violations } = playOfficialExecution(
    102,
    { throughMonth: warning.startMonth },
    { plan },
  );
  expect(violations).toEqual([]);
  const original = game.facilities.find((facility) => facility.id === 1)!;
  expect(original.fuel).toBe("Coal");
  expect(original.paused).not.toBe(true);
  expect(original.yearsToBuildLeft).toBeLessThanOrEqual(0);
  const receipt = game.worldEvents.occurrences.find(
    (event) => event.key === warning.key,
  )!;
  expect(receipt.attributes.selectedFacilityIds).toContain(original.id);
  expect(receipt.attributes.selectedFacilityNames).toContain(original.name);
  expect(validScenarioRuleState(game)).toBe(true);
  const envelope = roundTrip(game);
  const restored = parseSave(cloneDeep(envelope));
  expect(restored).not.toBeNull();
  expect(restored!.game.worldEvents).toEqual(game.worldEvents);
  const resumed = cloneDeep(restored!.game);
  advance(game, onset.startMonth);
  advance(resumed, onset.startMonth);
  expect(resumed.monthlyHistory).toEqual(game.monthlyHistory);
  expect(resumed.worldEvents).toEqual(game.worldEvents);
  const derate = game.worldEvents.occurrences.find(
    (event) => event.key === onset.key,
  )!;
  expect(derate.attributes.selectedFacilityIds).toContain(original.id);
  expect(validScenarioRuleState(game)).toBe(true);
  expect(parseSave(roundTrip(game))).not.toBeNull();
  const duplicate = cloneDeep(envelope) as ReturnType<typeof serializeSave>;
  for (const event of [
    ...duplicate.game.worldEvents.occurrences,
    ...duplicate.game.worldEvents.active,
  ])
    if (event.key === warning.key)
      event.attributes.selectedFacilityIds = [original.id, original.id];
  expect(parseSave(duplicate)).toBeNull();
  expect(parseSave(envelope)).not.toBeNull();
});
