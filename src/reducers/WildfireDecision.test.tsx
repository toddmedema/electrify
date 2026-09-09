import cloneDeep from "lodash.clonedeep";
import { createGame, createGameFromReplay } from "../testing/Simulator";
import reducer, { generateNewTimeline, tickState, delta } from "./Game";
import { chooseWildfireResponse } from "./GameActions";
import {
  getDateFromMinute,
  getTimeFromTimeline,
  MINUTES_PER_MONTH,
} from "../helpers/DateTime";
import { parseSave, serializeSave } from "../SaveGame";
import { decodeReplay, encodeReplay, serializeReplay } from "../Replay";
import {
  resolveStoryAtDate,
  WILDFIRE_DECISION_KEY,
  wildfirePreparationCost,
} from "../data/WorldEvents";
import { buildStorySnapshot } from "../helpers/Story";

function ready(month = 11, cash = 100000000) {
  const game = createGame({
    scenarioId: 111,
    difficulty: "Employee",
    seed: 2468,
  });
  game.date = getDateFromMinute(month * MINUTES_PER_MONTH, game.startingYear);
  game.timeline = generateNewTimeline(game, cash, 1000000);
  game.replayLog = [];
  return game;
}
const now = (game: ReturnType<typeof ready>) =>
  getTimeFromTimeline(game.date.minute, game.timeline)!;
function emergency(game: ReturnType<typeof ready>, month = 12) {
  return resolveStoryAtDate({
    seed: game.seed,
    scenarioId: game.scenarioId,
    difficulty: game.difficulty,
    date: getDateFromMinute(month * MINUTES_PER_MONTH, game.startingYear),
    location: game.location,
    snapshot: buildStorySnapshot(
      game.monthlyHistory,
      game.facilities,
      game.date.minute,
    ),
    occurrences: game.worldEvents.occurrences,
  });
}

test("preparedness costs cash once, records operating expense and survives save/replay", () => {
  const before = ready();
  const after = reducer(before, chooseWildfireResponse("prepare"));
  const cost = wildfirePreparationCost(before.difficulty);
  expect(now(after).cash).toBe(now(before).cash - cost);
  expect(now(after).expensesOM - now(before).expensesOM).toBeCloseTo(cost, 2);
  expect(
    after.worldEvents.occurrences.filter(
      (event) => event.key === WILDFIRE_DECISION_KEY,
    ),
  ).toHaveLength(1);
  expect(reducer(after, chooseWildfireResponse("prepare"))).toBe(after);
  expect(reducer(after, chooseWildfireResponse("standard"))).toBe(after);
  const loaded = parseSave(
    JSON.parse(JSON.stringify(serializeSave(after))),
  )!.game;
  expect(loaded.worldEvents.occurrences).toEqual(after.worldEvents.occurrences);
  expect(reducer(loaded, chooseWildfireResponse("prepare"))).toBe(loaded);
  const replay = decodeReplay(encodeReplay(serializeReplay(after)!))!;
  expect(replay.actions).toEqual([
    {
      minute: before.date.minute,
      type: "chooseWildfireResponse",
      payload: "prepare",
    },
  ]);
  expect(
    reducer(
      before,
      chooseWildfireResponse(replay.actions[0].payload as "prepare"),
    ),
  ).toEqual(after);
});

test("prepared crews halve physical losses, keep restoration cost, and recovery explains the choice", () => {
  const before = ready();
  const after = reducer(before, chooseWildfireResponse("prepare"));
  const standard = emergency(before).effects;
  const prepared = emergency(after).effects;
  expect(1 - prepared.demandMultiplier!).toBeCloseTo(
    (1 - standard.demandMultiplier!) / 2,
  );
  for (const [id, output] of Object.entries(
    standard.facilityOutputMultipliersById!,
  ))
    expect(prepared.facilityOutputMultipliersById![id]).toBe((1 + output) / 2);
  expect(prepared.operatingExpensePerMonth).toBe(
    standard.operatingExpensePerMonth,
  );
  expect(emergency(after, 14).occurrences[0].message).toContain(
    "funded preparedness",
  );
  expect(emergency(after, 14).effects).toEqual({});
});

test("standard response and ignored decision retain baseline effects", () => {
  const before = ready();
  const after = reducer(before, chooseWildfireResponse("standard"));
  expect(now(after).cash).toBe(now(before).cash);
  expect(emergency(after).effects).toEqual(emergency(before).effects);
});

test("rejects insufficient funds, wrong scenario, disabled stories, replay UI and deadline boundaries", () => {
  for (const month of [10, 12, 14]) {
    const game = ready(month);
    expect(reducer(game, chooseWildfireResponse("prepare"))).toBe(game);
  }
  for (const change of [{ scenarioId: 110 }, { storyEffectsDisabled: true }]) {
    const game = { ...ready(), ...change };
    expect(reducer(game, chooseWildfireResponse("prepare"))).toBe(game);
  }
  const playback = ready();
  playback.replayPlayback = { actions: [], index: 0 };
  expect(reducer(playback, chooseWildfireResponse("prepare"))).toBe(playback);
  const poor = cloneDeep(ready());
  now(poor).cash = wildfirePreparationCost(poor.difficulty) - 1;
  expect(reducer(poor, chooseWildfireResponse("prepare"))).toBe(poor);
  expect(reducer(poor, chooseWildfireResponse("standard"))).not.toBe(poor);
});

test.each(["prepare", "standard", undefined] as const)(
  "live/save/replay agree after recovery with %s",
  (choice) => {
    let live = createGame({
      scenarioId: 111,
      difficulty: "Employee",
      seed: 2468,
    });
    const advance = (game: typeof live, month: number) => {
      while (game.date.monthsElapsed < month) tickState(game);
    };
    advance(live, 11);
    if (choice) live = cloneDeep(reducer(live, chooseWildfireResponse(choice)));
    const saved = cloneDeep(
      parseSave(JSON.parse(JSON.stringify(serializeSave(live))))!.game,
    );
    const replay = createGameFromReplay(
      decodeReplay(encodeReplay(serializeReplay(live)!))!,
    );
    advance(live, 36);
    advance(saved, 36);
    advance(replay, 36);
    expect(replay.worldEvents.occurrences).toEqual(
      live.worldEvents.occurrences,
    );
    expect(saved.worldEvents.occurrences).toEqual(live.worldEvents.occurrences);
    expect(now(replay).cash).toEqual(now(live).cash);
    expect(now(saved).cash).toEqual(now(live).cash);
    expect(replay.monthlyHistory).toEqual(live.monthlyHistory);
  },
  120000,
);

test("another reforecast preserves the upfront charge in O&M", () => {
  const funded = reducer(ready(), chooseWildfireResponse("prepare"));
  const forecast = reducer(
    funded,
    delta({ dollarsPerkWh: funded.dollarsPerkWh }),
  );
  expect(now(forecast).expensesOM).toBe(now(funded).expensesOM);
  expect(now(forecast).cash).toBe(now(funded).cash);
});

test("forecast refresh includes funded disconnections without changing customer counts", () => {
  const before = ready();
  const after = cloneDeep(reducer(before, chooseWildfireResponse("prepare")));
  const standard = cloneDeep(before);
  standard.date = getDateFromMinute(
    12 * MINUTES_PER_MONTH,
    before.startingYear,
  );
  after.date = standard.date;
  const baseline = generateNewTimeline(standard, 100000000, 1000000);
  const prepared = generateNewTimeline(after, 100000000, 1000000);
  expect(prepared[0].customers).toBe(baseline[0].customers);
  expect(prepared[0].demandW / baseline[0].demandW).toBeCloseTo(0.98 / 0.96, 8);
  const repeatedBaseline = generateNewTimeline(standard, 100000000, 1000000);
  expect(repeatedBaseline[0].demandW).toBe(baseline[0].demandW);
});
