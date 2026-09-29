import cloneDeep from "lodash.clonedeep";
import { DEFAULT_CUSTOM_SCENARIO } from "../data/Scenarios";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../helpers/DateTime";
import {
  customEventContext,
  prepareCustomScenario,
} from "../helpers/CustomScenarioEvents";
import { createGame } from "../testing/Simulator";
import reducer, { generateNewTimeline } from "./Game";
import { parseSave, serializeSave } from "../SaveGame";
import { LOCATIONS } from "../Constants";
import {
  wildfirePreparedness,
  isWildfireHazardEligible,
} from "../helpers/Wildfire";
import { chooseScenarioResponse } from "./GameActions";
import { resolveStoryAtDate } from "../data/WorldEvents";
import { buildStorySnapshot } from "../helpers/Story";

function customGame() {
  return createGame({
    scenarioId: 999,
    scenario: prepareCustomScenario({ ...DEFAULT_CUSTOM_SCENARIO }),
    seed: 89014,
    difficulty: "Manager",
  });
}

test("custom event loads scale with the receiving grid without importing the source city's baseline industry", () => {
  const small = prepareCustomScenario({
    ...DEFAULT_CUSTOM_SCENARIO,
    startingYear: 2050,
    startingCustomers: 100000,
    durationMonths: 12,
    eventScenarioIds: [106, 114],
  });
  const large = prepareCustomScenario({ ...small, startingCustomers: 200000 });
  expect(small.locationId).toBe(DEFAULT_CUSTOM_SCENARIO.locationId);
  expect(small.facilities).toEqual(DEFAULT_CUSTOM_SCENARIO.facilities);
  expect(small.loadAdditions).toHaveLength(1);
  expect(small.loadAdditions![0]).toMatchObject({
    demandType: "Data Centers",
    startsYear: 2056,
  });
  expect(large.loadAdditions![0].peakW).toBe(small.loadAdditions![0].peakW * 2);
  expect(small.durationMonths).toBeGreaterThan(72);
});

test.each([[111, 111], [0], [987654], ["111"]])(
  "rejects invalid custom event IDs %j in saved games",
  (...eventScenarioIds) => {
    const save = JSON.parse(JSON.stringify(serializeSave(customGame())));
    save.game.customScenario.eventScenarioIds = eventScenarioIds;
    expect(parseSave(save)).toBeNull();
  },
);

test("an imported wildfire can be prepared for in an unprofiled location without enabling local random fires", () => {
  const game = customGame();
  game.location = LOCATIONS.PIT;
  game.customScenario!.eventScenarioIds = [111];
  expect(isWildfireHazardEligible(game)).toBe(false);
  const program = wildfirePreparedness(game)!;
  expect(program).toBeDefined();
  const funded = reducer(
    game,
    chooseScenarioResponse({
      decisionId: program.choice.id,
      optionId: "prepare",
    }),
  );
  const incident = (state: typeof game, month = 36) =>
    resolveStoryAtDate({
      seed: state.seed,
      scenarioId: 999,
      difficulty: state.difficulty,
      date: getDateFromMinute(month * MINUTES_PER_MONTH, state.startingYear),
      location: state.location,
      customEvents: customEventContext(state.customScenario),
      occurrences: state.worldEvents.occurrences,
      snapshot: buildStorySnapshot(
        state.monthlyHistory,
        state.facilities,
        state.date.minute,
      ),
    }).active.find((event) => event.key.endsWith(":firestorm"))!;
  const normal = incident(game);
  const protectedFire = incident(funded);
  expect(protectedFire.attributes.preparednessEffectiveness).toBe(1);
  expect(1 - protectedFire.effects.demandMultiplier!).toBeCloseTo(
    (1 - normal.effects.demandMultiplier!) / 2,
  );
  expect(protectedFire.effects.operatingExpensePerMonth).toBe(
    normal.effects.operatingExpensePerMonth,
  );
  expect(incident(funded, 37).effects).toEqual(protectedFire.effects);
});

test("changing custom event selection with the same seed invalidates forecast effects", () => {
  const game = customGame();
  game.date = getDateFromMinute(41 * MINUTES_PER_MONTH, game.startingYear);
  const baseline = generateNewTimeline(game, 1e9, 1e6, 1)[0];
  const changed = cloneDeep(game);
  changed.customScenario!.eventScenarioIds = [108];
  const heat = generateNewTimeline(changed, 1e9, 1e6, 1)[0];
  expect(heat.demandW).toBeGreaterThan(baseline.demandW * 1.05);
  changed.customScenario!.eventScenarioIds = [];
  expect(generateNewTimeline(changed, 1e9, 1e6, 1)[0].demandW).toBe(
    baseline.demandW,
  );
});

test("custom event monetary scale changes do not reuse another grid's forecast costs", () => {
  const game = customGame();
  game.date = getDateFromMinute(36 * MINUTES_PER_MONTH, game.startingYear);
  // Keep dispatch changes from changing variable O&M: this checks only restoration budgets.
  game.facilities.forEach((facility) => {
    facility.variableOperatingCostPerMWh = undefined;
  });
  const baseline = generateNewTimeline(game, 1e9, 1e6, 1)[0];
  game.customScenario!.eventScenarioIds = [111];
  const single = generateNewTimeline(game, 1e9, 1e6, 1)[0];
  game.customScenario!.startingCustomers! *= 2;
  const double = generateNewTimeline(game, 1e9, 1e6, 1)[0];
  expect(single.expensesOM).toBeGreaterThan(baseline.expensesOM);
  expect(double.expensesOM - baseline.expensesOM).toBeCloseTo(
    2 * (single.expensesOM - baseline.expensesOM),
    6,
  );
});

test("custom event save import rejects a nonnumeric grid scale before resolving event costs", () => {
  const game = customGame();
  game.customScenario!.eventScenarioIds = [111];
  const save = serializeSave(game);
  expect(parseSave(save)).not.toBeNull();
  const malformed = JSON.parse(JSON.stringify(save));
  malformed.game.customScenario.startingCustomers = "not a number";
  expect(parseSave(malformed)).toBeNull();
});

test("selected custom events survive save import with an identical future forecast", () => {
  const game = customGame();
  game.customScenario!.eventScenarioIds = [108, 111];
  const imported = parseSave(
    JSON.parse(JSON.stringify(serializeSave(game))),
  )!.game;
  const future = (state: typeof game) => {
    state.date = getDateFromMinute(41 * MINUTES_PER_MONTH, state.startingYear);
    return generateNewTimeline(state, 1e9, 1e6, 4);
  };
  expect(imported.customScenario!.eventScenarioIds).toEqual([108, 111]);
  expect(future(imported)).toEqual(future(game));
});

test("imported wildfire forecasts target the receiving fleet after a fleet change", () => {
  const game = customGame();
  game.customScenario!.eventScenarioIds = [111];
  game.date = getDateFromMinute(36 * MINUTES_PER_MONTH, game.startingYear);
  const original = generateNewTimeline(game, 1e9, 1e6, 4);
  const changedFleet = cloneDeep(game);
  changedFleet.facilities[0].id += 100;
  const changed = generateNewTimeline(changedFleet, 1e9, 1e6, 4);
  expect(changed.map((tick) => tick.supplyW)).toEqual(
    original.map((tick) => tick.supplyW),
  );
});
