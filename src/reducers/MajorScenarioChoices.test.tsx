import { GENERATORS } from "../data/Facilities";
import cloneDeep from "lodash.clonedeep";
import { TICK_MINUTES } from "../Constants";
import { createGame } from "../testing/Simulator";
import reducer, {
  generateNewTimeline,
  tickState,
  delta,
  retrofitFacility,
  cancelRetrofit,
  buildFacility,
} from "./Game";
import {
  chooseScenarioResponse,
  pageHidden,
  pageVisible,
  systemSuspend,
} from "./GameActions";
import {
  getDateFromMinute,
  getTimeFromTimeline,
  MINUTES_PER_MONTH,
} from "../helpers/DateTime";
import { parseSave } from "../SaveGame";
import {
  DATA_CENTER_DECISION_KEY,
  DATA_CENTER_GRANT,
} from "../data/ScenarioChoices";
import {
  DEEP_FREEZE_DECISION_KEY,
  resolveStoryAtDate,
} from "../data/WorldEvents";
import {
  bulkWinterizationQuote,
  retrofitOutputMultiplier,
  withResilienceOptions,
} from "../helpers/Hazards";
import { pendingScenarioChoice } from "../helpers/ScenarioChoices";
import { hasWinterization } from "../helpers/Winterization";
import { buildStorySnapshot, storyOutputMultiplier } from "../helpers/Story";
import { roundTrip } from "../testing/SaveForgery";

function ready(scenarioId: number, month: number) {
  const game = createGame({ scenarioId, difficulty: "Intern", seed: 2468 });
  game.date = getDateFromMinute(month * MINUTES_PER_MONTH, game.startingYear);
  game.timeline = generateNewTimeline(
    game,
    1000000000,
    game.scenarioId === 106 ? 16500 : 472701,
  );
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
  expect(now(after).revenueGrants).toBe(DATA_CENTER_GRANT.Intern);
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
  expect(now(refreshed).revenueGrants).toBe(DATA_CENTER_GRANT.Intern);
  const advanced = cloneDeep(refreshed);
  tickState(advanced);
  expect(now(advanced).revenue).toBeLessThan(DATA_CENTER_GRANT.Intern);
  expect(now(advanced).revenueGrants).toBe(0);
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
      )[0].demandByType["Data Centers"];
    };
    expect(demand(phased) / demand(before)).toBeCloseTo(ratio, 8);
  }
});

test("winterization halves output losses while retaining demand, fuel prices, and weather shock", () => {
  const before = ready(107, 36);
  const after = reducer(before, choose(DEEP_FREEZE_DECISION_KEY, "winterize"));
  expect(now(after).cash).toBe(
    now(before).cash - bulkWinterizationQuote(before).cost,
  );
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
  const freezeMinute = 49 * MINUTES_PER_MONTH;
  for (const facility of after.facilities) {
    const original = before.facilities.find((item) => item.id === facility.id)!;
    expect(
      1 - storyOutputMultiplier(facility, protectedEffects, freezeMinute),
    ).toBeCloseTo(
      (1 - storyOutputMultiplier(original, standard, freezeMinute)) / 2,
      8,
    );
    expect(retrofitOutputMultiplier(facility, after.date.minute)).toBe(0.9);
  }
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
    "Winterized plants take half the output loss.",
  );
  const poor = cloneDeep(before);
  now(poor).cash = bulkWinterizationQuote(poor).cost - 1;
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
  "scenario %s / month %s / %s / %s survives save continuation",
  (scenarioId, month, decisionId, optionId, endMonth) => {
    let live = createGame({ scenarioId, difficulty: "Intern", seed: 2468 });
    const advance = (game: typeof live, target: number) => {
      while (game.date.monthsElapsed < target) tickState(game);
    };
    advance(live, month);
    live = cloneDeep(reducer(live, choose(decisionId, optionId)));
    const saved = cloneDeep(parseSave(roundTrip(live))!.game);
    advance(live, endMonth);
    advance(saved, endMonth);
    expect(saved.loadAdditions).toEqual(live.loadAdditions);
    expect(saved.worldEvents.occurrences).toEqual(live.worldEvents.occurrences);
    expect(now(saved).cash).toBe(now(live).cash);
  },
  120000,
);

test("bulk retrofit excludes installed and pending assets, charges once, and cancellation restores only that asset's exposure", () => {
  const before = ready(107, 36);
  const wind = before.facilities.find((item) => item.fuel === "Wind")!;
  wind.resilience = { coldWeatherPackage: true };
  const gas = before.facilities.find((item) => item.fuel === "Natural Gas")!;
  const individual = reducer(
    before,
    retrofitFacility({ facilityId: gas.id, upgrade: "coldWeatherPackage" }),
  );
  const quote = bulkWinterizationQuote(individual);
  expect(quote.facilities).toHaveLength(2);
  expect(pendingScenarioChoice(individual)?.options[0].cost("Intern")).toBe(
    quote.cost,
  );
  const after = reducer(
    individual,
    choose(DEEP_FREEZE_DECISION_KEY, "winterize"),
  );
  expect(now(individual).cash - now(after).cash).toBe(quote.cost);
  expect(
    after.facilities.filter((item) => item.upgradeInProgress),
  ).toHaveLength(3);
  const refreshed = reducer(
    after,
    delta({ dollarsPerkWh: after.dollarsPerkWh }),
  );
  expect(now(refreshed).cash).toBe(now(after).cash);
  expect(now(refreshed).expensesOM).toBe(now(after).expensesOM);
  const coal = after.facilities.find((item) => item.fuel === "Coal")!;
  const refund = coal.upgradeInProgress!.cost;
  const cancelled = reducer(after, cancelRetrofit(coal.id));
  expect(now(cancelled).cash - now(after).cash).toBe(refund);
  expect(
    hasWinterization(
      cancelled.facilities.find((item) => item.id === coal.id)!,
      49 * MINUTES_PER_MONTH,
    ),
  ).toBe(false);
  expect(
    hasWinterization(
      cancelled.facilities.find((item) => item.id === gas.id)!,
      49 * MINUTES_PER_MONTH,
    ),
  ).toBe(true);
  expect(reducer(cancelled, cancelRetrofit(coal.id))).toBe(cancelled);
});

test("later construction needs its own package after accepting bulk winterization, including after save", () => {
  let state = cloneDeep(
    reducer(ready(107, 36), choose(DEEP_FREEZE_DECISION_KEY, "winterize")),
  );
  const ids: number[] = [];
  for (const protectedPlant of [false, true]) {
    const quote = GENERATORS(state, 10e6, [], []).find(
      (item) => item.name === "Natural Gas Peaker",
    )!;
    const priorIds = new Set(state.facilities.map((item) => item.id));
    state = cloneDeep(
      reducer(
        state,
        buildFacility({
          facility: withResilienceOptions(quote, state, {
            coldWeatherPackage: protectedPlant,
          }),
          financed: false,
        }),
      ),
    );
    const added = state.facilities.find((item) => !priorIds.has(item.id))!;
    expect(added).toBeDefined();
    ids.push(added.id);
  }
  while (state.date.monthsElapsed < 49) tickState(state);
  const restored = parseSave(roundTrip(state))!.game;
  const effects = resolveStoryAtDate({
    seed: restored.seed,
    scenarioId: restored.scenarioId,
    difficulty: restored.difficulty,
    date: restored.date,
    location: restored.location,
    snapshot: buildStorySnapshot(
      restored.monthlyHistory,
      restored.facilities,
      restored.date.minute,
    ),
    occurrences: restored.worldEvents.occurrences,
  }).effects;
  const standard = restored.facilities.find((item) => item.id === ids[0])!;
  const protectedPlant = restored.facilities.find(
    (item) => item.id === ids[1],
  )!;
  expect(standard.yearsToBuildLeft).toBe(0);
  expect(protectedPlant.yearsToBuildLeft).toBe(0);
  expect(
    storyOutputMultiplier(standard, effects, restored.date.minute),
  ).toBeCloseTo(0.62);
  expect(
    storyOutputMultiplier(protectedPlant, effects, restored.date.minute),
  ).toBeCloseTo(0.81);
});

test("fully protected fleet acknowledges the offer without payment or new work", () => {
  const before = ready(107, 36);
  before.facilities.forEach((facility) => {
    facility.resilience = { ...facility.resilience, coldWeatherPackage: true };
  });
  expect(bulkWinterizationQuote(before)).toEqual({ facilities: [], cost: 0 });
  expect(pendingScenarioChoice(before)?.options[0].label).toBe(
    "Already prepared",
  );
  const after = reducer(before, choose(DEEP_FREEZE_DECISION_KEY, "winterize"));
  expect(now(after).cash).toBe(now(before).cash);
  expect(after.facilities.some((facility) => facility.upgradeInProgress)).toBe(
    false,
  );
  expect(after.meaningfulDecisions).toEqual(before.meaningfulDecisions);
});

test("individual winterization protects a plant when the bulk offer is declined", () => {
  const before = ready(107, 35);
  const gas = before.facilities.find((item) => item.fuel === "Natural Gas")!;
  const upgraded = cloneDeep(
    reducer(
      before,
      retrofitFacility({ facilityId: gas.id, upgrade: "coldWeatherPackage" }),
    ),
  );
  while (upgraded.date.monthsElapsed < 36) tickState(upgraded);
  const after = reducer(upgraded, choose(DEEP_FREEZE_DECISION_KEY, "standard"));
  const plant = after.facilities.find((item) => item.id === gas.id)!;
  expect(plant.resilience?.coldWeatherPackage).toBe(true);
  expect(plant.upgradeInProgress).toBeUndefined();
  const effects = {
    winterizationOutputMultipliersByFuel: { "Natural Gas": 0.62 },
  };
  expect(storyOutputMultiplier(plant, effects)).toBeCloseTo(0.81);
  expect(
    storyOutputMultiplier({ ...plant, resilience: undefined }, effects),
  ).toBe(0.62);
});

describe("scenario decision speed restoration", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it.each(["SLOW", "NORMAL", "FAST", "PAUSED"] as const)(
    "stays paused after a valid response from %s",
    (speed) => {
      const game = ready(106, 48 - TICK_MINUTES / MINUTES_PER_MONTH);
      game.speed = speed;
      tickState(game);
      expect(game.speed).toBe("PAUSED");
      expect(game.scenarioChoicePause).toBe(speed);
      const invalid = reducer(
        game,
        choose(DATA_CENTER_DECISION_KEY, "invalid"),
      );
      expect(invalid.speed).toBe("PAUSED");
      const chosen = reducer(
        invalid,
        choose(DATA_CENTER_DECISION_KEY, "phased"),
      );
      expect(chosen.speed).toBe("PAUSED");
      expect(chosen.scenarioChoicePause).toBeUndefined();
    },
  );
});

test("a scenario answer after system sleep keeps the clock paused", () => {
  const game = ready(106, 48 - TICK_MINUTES / MINUTES_PER_MONTH);
  game.speed = "FAST";
  tickState(game);
  expect(game.scenarioChoicePause).toBe("FAST");
  let state = reducer(game, pageHidden());
  state = reducer(state, systemSuspend());
  state = reducer(state, pageVisible());
  state = reducer(state, choose(DATA_CENTER_DECISION_KEY, "phased"));
  expect(state.speed).toBe("PAUSED");
  expect(state.scenarioChoicePause).toBeUndefined();
});
