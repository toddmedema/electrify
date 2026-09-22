import { createNextState } from "@reduxjs/toolkit";
import cloneDeep from "lodash.clonedeep";
import { createGame } from "../testing/Simulator";
import reducer, { generateNewTimeline } from "../reducers/Game";
import { chooseScenarioResponse } from "../reducers/GameActions";
import { DATA_CENTER_DECISION_KEY } from "../data/ScenarioChoices";
import { WILDFIRE_DECISION_KEY } from "../data/WorldEvents";
import { getDateFromMinute, MINUTES_PER_MONTH } from "./DateTime";
import { selectProjection } from "./Projection";
import { cashRunwayMonths } from "./MissionStatus";

it("does not count ordinary within-month cash burn twice", () => {
  const game = createGame({ scenarioId: 111, seed: 7 });
  game.dollarsPerkWh = 0;
  game.timeline = generateNewTimeline(
    game,
    5_000_000,
    game.timeline[0].customers,
  );
  const projection = selectProjection(game, game.timeline[0]);
  const runway = cashRunwayMonths(game);
  expect(runway).toBeGreaterThan(1);
  expect(runway).toBeLessThan(12);
  for (const tick of game.timeline.filter((t) => t.cash >= 0)) {
    const advanced = {
      ...game,
      date: getDateFromMinute(tick.minute, game.startingYear),
    };
    expect(selectProjection(advanced, tick)).toBe(projection);
    expect(cashRunwayMonths(advanced)).toBe(runway);
  }
  const expense = createNextState(game, (draft) => {
    for (const tick of draft.timeline) tick.cash -= 2_000_000;
  });
  expect(cashRunwayMonths(expense)).toBeLessThan(runway!);
});

it("rebuilds for another save with identical monthly keys but different balances", () => {
  const game = createGame({ scenarioId: 111, seed: 7 });
  const before = selectProjection(game, game.timeline[0]);
  const loaded = cloneDeep(game);
  for (const tick of loaded.timeline) tick.cash += 1_000_000;
  const after = selectProjection(loaded, loaded.timeline[0]);
  expect(after).not.toBe(before);
  expect(after.financePast).toBe(loaded.monthlyHistory);
  expect(after.startingCash).toBe(before.startingCash + 1_000_000);
  expect(after.financeProjected[1].cash).toBe(
    before.financeProjected[1].cash + 1_000_000,
  );
});

it.each([
  [106, 48, DATA_CENTER_DECISION_KEY, "phased"],
  [111, 11, WILDFIRE_DECISION_KEY, "prepare"],
] as const)(
  "refreshes the forecast after scenario %i's choice",
  (scenarioId, month, decisionId, optionId) => {
    const game = createGame({ scenarioId, difficulty: "Intern", seed: 2468 });
    game.date = getDateFromMinute(month * MINUTES_PER_MONTH, game.startingYear);
    game.timeline = generateNewTimeline(
      game,
      1_000_000_000,
      game.timeline[0].customers,
    );
    const before = selectProjection(game, game.timeline[0]);
    const chosen = reducer(
      game,
      chooseScenarioResponse({ decisionId, optionId }),
    );
    expect(chosen.worldEvents.occurrences.length).toBeGreaterThan(
      game.worldEvents.occurrences.length,
    );
    const after = selectProjection(chosen, chosen.timeline[0]);
    expect(after).not.toBe(before);
    expect(after.financeProjected).not.toEqual(before.financeProjected);
    expect(after.forecast).toEqual(
      generateNewTimeline(
        chosen,
        chosen.timeline[0].cash,
        chosen.timeline[0].customers,
        after.forecast.length,
        after.projectionStepMinutes,
      ),
    );
  },
);
