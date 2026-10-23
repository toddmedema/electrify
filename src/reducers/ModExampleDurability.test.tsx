import "../Store";
import cloneDeep from "lodash.clonedeep";
import { TICKS_PER_MONTH } from "../Constants";
import { MINUTES_PER_MONTH } from "../helpers/DateTime";
import { currentTick } from "../helpers/GameSelectors";
import { gameObjectiveResults } from "../helpers/ObjectiveRules";
import { pendingScenarioChoice } from "../helpers/ScenarioChoices";
import { modScenario } from "../mods/ModScenario";
import { parseSave } from "../SaveGame";
import {
  modExampleRoute,
  modExampleScenario,
} from "../testing/ModExampleFixtures";
import { createGame } from "../testing/Simulator";
import type { GameType } from "../Types";
import reducer, { reprioritizeFacility, tickState } from "./Game";
import { chooseScenarioResponse } from "./GameActions";
import { roundTrip } from "../testing/SaveForgery";

function advance(input: GameType, month: number): GameType {
  let game = input;
  for (
    let tick = 0;
    game.date.monthsElapsed < month && tick < (month + 1) * TICKS_PER_MONTH;
    tick++
  ) {
    expect(pendingScenarioChoice(game)).toBeUndefined();
    if (game.date.minute % MINUTES_PER_MONTH === 0) {
      for (const action of modExampleRoute("two-dry-years").scheduledActions ??
        []) {
        if (
          action.type !== "reprioritize" ||
          action.month !== game.date.monthsElapsed
        )
          continue;
        const spotInList = game.facilities.findIndex(
          (facility) => facility.id === action.facilityId,
        );
        game = cloneDeep(
          reducer(
            game,
            reprioritizeFacility({
              spotInList,
              delta: spotInList === 0 ? 1 : -1,
            }),
          ),
        );
      }
    }
    tickState(game);
  }
  expect(game.date.monthsElapsed).toBe(month);
  return game;
}
function answer(game: GameType, optionId: string): GameType {
  const choice = pendingScenarioChoice(game);
  expect(choice).toBeDefined();
  return cloneDeep(
    reducer(game, chooseScenarioResponse({ decisionId: choice!.id, optionId })),
  );
}
const envelope = (game: GameType) => roundTrip(game);
function restore(value: ReturnType<typeof envelope>) {
  const saved = parseSave(value);
  expect(saved).not.toBeNull();
  return cloneDeep(saved!.game);
}
beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

test("a two-decision drought save resumes identically after an update, removal and unavailable library", () => {
  const { pack, scenario } = modExampleScenario("two-dry-years");
  let original = createGame({
    ...modExampleRoute("two-dry-years"),
    scenarioId: 999,
    scenario,
    difficulty: "Employee",
    seed: pack.seed ?? 0,
  });
  original = advance(original, 11);
  expect(pendingScenarioChoice(original)!.id).toBe(
    "mod:two-dry-years:first-year-response",
  );
  original = answer(original, "fuel-support");
  original = advance(original, 24);
  expect(pendingScenarioChoice(original)!.id).toBe(
    "mod:two-dry-years:second-year-response",
  );
  const pending = envelope(original);
  const digest = original.customScenario!.mod!.runtimeDigest;
  const updated = cloneDeep(pack);
  updated.version = "2";
  updated.events!.find(
    (event) => event.id === "first-dry-year",
  )!.effects!.hydroInflowMultiplier = 0.75;
  const library = new Map([
    [pack.id, modScenario(updated, undefined, "Employee")],
  ]);
  expect(library.get(pack.id)!.mod!.runtimeDigest).not.toBe(digest);
  library.delete(pack.id);
  expect(library.size).toBe(0);
  const previousBridge = window.electrifyDesktop;
  const unavailableLibrary = jest.fn(() => {
    throw new Error("Library unavailable");
  });
  Object.defineProperty(window, "electrifyDesktop", {
    configurable: true,
    value: { ...previousBridge, apiVersion: 1, mods: unavailableLibrary },
  });
  try {
    let resumed = restore(pending);
    expect(resumed.customScenario!.mod!.source.version).toBe("1");
    expect(resumed.customScenario!.mod!.runtimeDigest).toBe(digest);
    expect(pendingScenarioChoice(resumed)!.id).toBe(
      "mod:two-dry-years:second-year-response",
    );
    const beforeDuplicate = currentTick(resumed)!.cash;
    const duplicate = reducer(
      resumed,
      chooseScenarioResponse({
        decisionId: "mod:two-dry-years:first-year-response",
        optionId: "fuel-support",
      }),
    );
    expect(currentTick(duplicate)!.cash).toBe(beforeDuplicate);
    expect(duplicate.worldEvents.occurrences).toEqual(
      resumed.worldEvents.occurrences,
    );
    original = advance(answer(original, "conserve"), 26);
    resumed = advance(answer(resumed, "conserve"), 26);
    const answered = restore(envelope(resumed));
    expect(pendingScenarioChoice(answered)).toBeUndefined();
    const finishedOriginal = advance(original, 48);
    for (const candidate of [resumed, answered]) {
      const finished = advance(candidate, 48);
      expect(finished.monthlyHistory).toEqual(finishedOriginal.monthlyHistory);
      // Saves encode a non-finite display-only lcWh estimate as null; compare the
      // complete persisted fleet, including every finite operating/reservoir fact.
      expect(JSON.parse(JSON.stringify(finished.facilities))).toEqual(
        JSON.parse(JSON.stringify(finishedOriginal.facilities)),
      );
      expect(finished.worldEvents).toEqual(finishedOriginal.worldEvents);
      expect(finished.objectiveProgress).toEqual(
        finishedOriginal.objectiveProgress,
      );
      expect(currentTick(finished)).toEqual(currentTick(finishedOriginal));
      expect(
        gameObjectiveResults(finished).every(
          (goal) => goal.status === "completed",
        ),
      ).toBe(true);
      expect(finished.customScenario!.mod!.runtimeDigest).toBe(digest);
      expect(
        finished.worldEvents.occurrences.filter(
          (event) => event.attributes.scenarioChoice,
        ),
      ).toHaveLength(2);
      expect(
        finished.monthlyHistory.reduce(
          (total, month) => total + month.revenueGrants,
          0,
        ),
      ).toBe(5000000);
    }
    expect(unavailableLibrary).not.toHaveBeenCalled();
  } finally {
    Object.defineProperty(window, "electrifyDesktop", {
      configurable: true,
      value: previousBridge,
    });
  }
});
