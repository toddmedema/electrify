import { createNextState } from "@reduxjs/toolkit";
import cloneDeep from "lodash.clonedeep";
import { createGame } from "../testing/Simulator";
import reducer, {
  buildTransmissionLine,
  generateNewTimeline,
  upgradeTransmissionLine,
} from "../reducers/Game";
import * as GameModule from "../reducers/Game";
import { chooseScenarioResponse } from "../reducers/GameActions";
import { CUSTOM_SCENARIO_ID, SCENARIOS } from "../data/Scenarios";
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

it("caps a 100-year custom game at 20 years of cash and chart simulation", () => {
  const game = createGame({ scenarioId: 111, seed: 7 });
  game.scenarioId = CUSTOM_SCENARIO_ID;
  game.customScenario = {
    ...SCENARIOS.find((scenario) => scenario.id === 111)!,
    durationMonths: 1200,
  };
  const generate = jest.spyOn(GameModule, "generateNewTimeline");
  const projection = selectProjection(game, game.timeline[0]);
  expect(generate).toHaveBeenCalledWith(
    game,
    game.timeline[0].cash,
    game.timeline[0].customers,
    20 * 12 * 24,
    60,
  );
  generate.mockRestore();
  expect(projection.cashProjected).toHaveLength(240);
  expect(projection.financeProjected).toHaveLength(240);
  expect(projection.forecast).toHaveLength(20 * 12 * 24);
  expect(projection.domain.x[1]).toBe(20 * 12 * MINUTES_PER_MONTH);
});

it("refreshes projections when an intertie upgrade starts and completes", () => {
  const game = createGame({ scenarioId: 100, seed: 61 });
  game.timeline[0].cash = 100_000_000_000;
  const open = cloneDeep(
    reducer(
      game,
      buildTransmissionLine({
        corridorId: "california-north",
        financed: false,
      }),
    ),
  );
  open.transmission!.lines[0].yearsToBuildLeft = 0;
  const before = selectProjection(open, open.timeline[0]);
  const upgrading = reducer(
    open,
    upgradeTransmissionLine({ corridorId: "california-north", financed: true }),
  );
  const during = selectProjection(upgrading, upgrading.timeline[0]);
  expect(during).not.toBe(before);
  expect(during.financeProjected).not.toEqual(before.financeProjected);
  expect(during.forecast).toEqual(
    generateNewTimeline(
      upgrading,
      upgrading.timeline[0].cash,
      upgrading.timeline[0].customers,
      during.forecast.length,
      during.projectionStepMinutes,
    ),
  );

  const progressed = createNextState(upgrading, (draft) => {
    draft.transmission!.lines[0].upgrade!.yearsToBuildLeft -= 0.001;
  });
  expect(selectProjection(progressed, progressed.timeline[0])).toBe(during);

  const completed = createNextState(upgrading, (draft) => {
    const line = draft.transmission!.lines[0];
    line.capacityW = line.upgrade!.targetCapacityW;
    line.annualOperatingCost = line.upgrade!.annualOperatingCost;
    delete line.upgrade;
  });
  const after = selectProjection(completed, completed.timeline[0]);
  expect(after).not.toBe(during);
  expect(after.forecast).toEqual(
    generateNewTimeline(
      completed,
      completed.timeline[0].cash,
      completed.timeline[0].customers,
      after.forecast.length,
      after.projectionStepMinutes,
    ),
  );
});
