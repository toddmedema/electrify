import cloneDeep from "lodash.clonedeep";
import { createGame, createGameFromReplay } from "../testing/Simulator";
import reducer, { generateNewTimeline, tickState, delta } from "./Game";
import { chooseScenarioResponse } from "./GameActions";
import {
  getDateFromMinute,
  getTimeFromTimeline,
  MINUTES_PER_MONTH,
} from "../helpers/DateTime";
import { parseSave, serializeSave } from "../SaveGame";
import { decodeReplay, encodeReplay, serializeReplay } from "../Replay";
import {
  DATA_CENTER_DECISION_KEY,
  DATA_CENTER_GRANT,
} from "../data/ScenarioChoices";
import {
  DEEP_FREEZE_DECISION_KEY,
  winterizationCost,
  resolveStoryAtDate,
} from "../data/WorldEvents";
import { buildStorySnapshot } from "../helpers/Story";

function ready(scenarioId: number, month: number) {
  const game = createGame({ scenarioId, difficulty: "Intern", seed: 2468 });
  game.date = getDateFromMinute(month * MINUTES_PER_MONTH, game.startingYear);
  game.timeline = generateNewTimeline(
    game,
    1000000000,
    game.scenarioId === 106 ? 16500 : 472701,
  );
  game.replayLog = [];
  return game;
}
const now = (game: ReturnType<typeof ready>) =>
  getTimeFromTimeline(game.date.minute, game.timeline)!;
const choose = (decisionId: string, optionId: string) =>
  chooseScenarioResponse({ decisionId, optionId });

test("developer contribution is paid once, remains revenue after reforecast and never becomes plant sales", () => {
  const before = ready(106, 48);
  const after = reducer(before, choose(DATA_CENTER_DECISION_KEY, "fast-track"));
  expect(now(after).cash - now(before).cash).toBe(DATA_CENTER_GRANT.Intern);
  expect(now(after).revenue - now(before).revenue).toBe(
    DATA_CENTER_GRANT.Intern,
  );
  expect(now(after).expensesOM).toBe(now(before).expensesOM);
  expect(after.facilities.map((f) => f.lifetimeRevenue)).toEqual(
    before.facilities.map((f) => f.lifetimeRevenue),
  );
  expect(reducer(after, choose(DATA_CENTER_DECISION_KEY, "phased"))).toBe(
    after,
  );
  const refreshed = reducer(
    after,
    delta({ dollarsPerkWh: after.dollarsPerkWh }),
  );
  expect(now(refreshed).revenue).toBe(now(after).revenue);
  expect(now(refreshed).cash).toBe(now(after).cash);
  const advanced = cloneDeep(refreshed);
  tickState(advanced);
  expect(now(advanced).revenue).toBeLessThan(DATA_CENTER_GRANT.Intern);
});

test("phased connection halves initial data-center load and rejoins full load in 2028", () => {
  const before = ready(106, 48);
  const phased = reducer(before, choose(DATA_CENTER_DECISION_KEY, "phased"));
  expect(now(phased).cash).toBe(now(before).cash);
  expect(phased.loadAdditions.map((a) => a.startsYear)).toEqual([2026, 2028]);
  for (const [month, ratio] of [
    [72, 0.5],
    [96, 1],
  ]) {
    const demand = (game: typeof before) => {
      const future = cloneDeep(game);
      future.date = getDateFromMinute(
        month * MINUTES_PER_MONTH,
        future.startingYear,
      );
      return generateNewTimeline(
        future,
        1000000000,
        future.scenarioId === 106 ? 16500 : 472701,
      )[0].demandByType["Data centers"];
    };
    expect(demand(phased) / demand(before)).toBeCloseTo(ratio, 8);
  }
});

test("winterization halves output losses while retaining demand, fuel prices, and weather shock", () => {
  const before = ready(107, 36);
  const after = reducer(before, choose(DEEP_FREEZE_DECISION_KEY, "winterize"));
  expect(now(after).cash).toBe(now(before).cash - winterizationCost("Intern"));
  const emergency = (game: typeof before) =>
    resolveStoryAtDate({
      seed: game.seed,
      scenarioId: game.scenarioId,
      difficulty: game.difficulty,
      date: getDateFromMinute(49 * MINUTES_PER_MONTH, game.startingYear),
      location: game.location,
      snapshot: buildStorySnapshot(
        game.monthlyHistory,
        game.facilities,
        game.date.minute,
      ),
      occurrences: game.worldEvents.occurrences,
    });
  const standard = emergency(before).effects;
  const protectedEffects = emergency(after).effects;
  expect(protectedEffects.demandMultiplier).toBe(standard.demandMultiplier);
  expect(protectedEffects.fuelPriceMultipliers).toEqual(
    standard.fuelPriceMultipliers,
  );
  expect(protectedEffects.temperatureOffsetC).toBe(standard.temperatureOffsetC);
  for (const fuel of ["Natural Gas", "Coal", "Uranium", "Wind"] as const)
    expect(
      1 - protectedEffects.facilityOutputMultipliersByFuel![fuel]!,
    ).toBeCloseTo(
      (1 - standard.facilityOutputMultipliersByFuel![fuel]!) / 2,
      8,
    );
  const forecast = (game: typeof before) => {
    const future = cloneDeep(game);
    future.date = getDateFromMinute(
      49 * MINUTES_PER_MONTH,
      future.startingYear,
    );
    return generateNewTimeline(future, 1000000000, 472701);
  };
  const baselineForecast = forecast(before);
  const protectedForecast = forecast(after);
  expect(protectedForecast.map((t) => t.demandW)).toEqual(
    baselineForecast.map((t) => t.demandW),
  );
  expect(
    protectedForecast.reduce((sum, t) => sum + t.supplyW, 0),
  ).toBeGreaterThan(baselineForecast.reduce((sum, t) => sum + t.supplyW, 0));
  expect(forecast(before).map((t) => t.supplyW)).toEqual(
    baselineForecast.map((t) => t.supplyW),
  );
  expect(emergency(after).occurrences[0].message).toContain(
    "funded winterization",
  );
  const poor = cloneDeep(before);
  now(poor).cash = winterizationCost("Intern") - 1;
  expect(reducer(poor, choose(DEEP_FREEZE_DECISION_KEY, "winterize"))).toBe(
    poor,
  );
  expect(reducer(poor, choose(DEEP_FREEZE_DECISION_KEY, "standard"))).not.toBe(
    poor,
  );
});

test.each([
  [106, 48, DATA_CENTER_DECISION_KEY, "fast-track", 97],
  [106, 48, DATA_CENTER_DECISION_KEY, "phased", 97],
  [107, 36, DEEP_FREEZE_DECISION_KEY, "winterize", 51],
  [107, 36, DEEP_FREEZE_DECISION_KEY, "standard", 51],
] as const)(
  "scenario %s / month %s / %s / %s survives save and deterministic replay",
  (scenarioId, month, decisionId, optionId, endMonth) => {
    let live = createGame({ scenarioId, difficulty: "Intern", seed: 2468 });
    const advance = (game: typeof live, target: number) => {
      while (game.date.monthsElapsed < target) tickState(game);
    };
    advance(live, month);
    live = cloneDeep(reducer(live, choose(decisionId, optionId)));
    const saved = cloneDeep(
      parseSave(JSON.parse(JSON.stringify(serializeSave(live))))!.game,
    );
    const replayed = createGameFromReplay(
      decodeReplay(encodeReplay(serializeReplay(live)!))!,
    );
    advance(live, endMonth);
    advance(saved, endMonth);
    advance(replayed, endMonth);
    expect(saved.loadAdditions).toEqual(live.loadAdditions);
    expect(replayed.loadAdditions).toEqual(live.loadAdditions);
    expect(saved.worldEvents.occurrences).toEqual(live.worldEvents.occurrences);
    expect(replayed.worldEvents.occurrences).toEqual(
      live.worldEvents.occurrences,
    );
    expect(now(saved).cash).toBe(now(live).cash);
    expect(now(replayed).cash).toBe(now(live).cash);
    expect(replayed.monthlyHistory).toEqual(live.monthlyHistory);
  },
  120000,
);

// A fixed 2020-dollar planning allowance covers the same protection service;
// difficulty changes demand/economics rather than introducing another price multiplier.
test.each(["Intern", "Employee", "Manager", "VP", "CEO"] as const)(
  "winterization keeps the research-based allowance on %s",
  (difficulty) => expect(winterizationCost(difficulty)).toBe(90000000),
);
