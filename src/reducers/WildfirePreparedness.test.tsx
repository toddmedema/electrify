import cloneDeep from "lodash.clonedeep";
import { createGame } from "../testing/Simulator";
import { CUSTOM_SCENARIO_ID, SCENARIOS } from "../data/Scenarios";
import { getWildfireProfile } from "../data/WildfireProfiles";
import { parseSave, serializeSave } from "../SaveGame";
import { serializeReplay } from "../Replay";
import { TICKS_PER_YEAR } from "../Constants";
import { GameType } from "../Types";
import { advancePolicies } from "../helpers/Policies";
import reducer, { generateNewTimeline, setSpeed, tickState } from "./Game";
import { chooseScenarioResponse } from "./GameActions";
import {
  getDateFromMinute,
  getTimeFromTimeline,
  MINUTES_PER_MONTH,
} from "../helpers/DateTime";
import {
  optionalScenarioChoice,
  pendingScenarioChoice,
} from "../helpers/ScenarioChoices";
import {
  activePreparedness,
  wildfirePreparedness,
  wildfirePreparednessEffectiveness,
} from "../helpers/Wildfire";
import {
  previewWildfire,
  wildfirePreviewMonth,
} from "../helpers/WildfirePreview";

const LA = getWildfireProfile("LA")!;

/** A custom Los Angeles game in April, between fire seasons, with a live forecast. */
function ready(cash = 100000000, month = 3): GameType {
  const game = createGame({
    scenarioId: CUSTOM_SCENARIO_ID,
    scenario: {
      ...SCENARIOS.find((s) => s.id === 111)!,
      id: CUSTOM_SCENARIO_ID,
      name: "Custom LA",
    },
    seed: 7,
  });
  game.date = getDateFromMinute(month * MINUTES_PER_MONTH, game.startingYear);
  advancePolicies(game, month);
  game.timeline = generateNewTimeline(game, cash, 1000000);
  game.replayLog = [];
  return game;
}
const now = (game: GameType) =>
  getTimeFromTimeline(game.date.minute, game.timeline)!;
const fund = (game: GameType) =>
  chooseScenarioResponse({
    decisionId: wildfirePreparedness(game)!.choice!.id,
    optionId: "prepare",
  });

test("preparedness is an optional program: the clock never waits on it", () => {
  const game = ready();
  expect(optionalScenarioChoice(game)?.id).toBe("wildfire:LA:preparedness:0");
  expect(pendingScenarioChoice(game)).toBeUndefined();
  expect(reducer(game, setSpeed("FAST")).speed).toBe("FAST");
});

test("starting has no upfront cost, persists through later seasons, and saves/replays", () => {
  const before = ready();
  const { annualCost, season } = wildfirePreparedness(before)!;
  expect(annualCost).toBeGreaterThan(0);
  const action = fund(before);
  const after = reducer(before, action);
  expect(now(after).cash).toBe(now(before).cash);
  expect(wildfirePreparedness(after)!.active).toBe(true);
  expect(
    optionalScenarioChoice(after)!.options.map((option) => option.id),
  ).toEqual(["stop"]);
  for (const month of [
    season.startMonth,
    season.endMonth,
    season.startMonth + 12,
    season.startMonth + 24,
  ])
    expect(activePreparedness(after.worldEvents.occurrences, "LA", month)).toBe(
      true,
    );
  expect(reducer(after, action)).toBe(after);
  const loaded = parseSave(
    JSON.parse(JSON.stringify(serializeSave(after))),
  )!.game;
  expect(wildfirePreparedness(loaded)!.active).toBe(true);
  expect(wildfirePreparedness(loaded)!.annualCost).toBe(annualCost);
  const replay = serializeReplay(after)!;
  expect(replay.actions).toEqual([
    {
      minute: before.date.minute,
      type: "chooseScenarioResponse",
      payload: action.payload,
    },
  ]);
  expect(
    reducer(
      cloneDeep(before),
      chooseScenarioResponse(
        replay.actions[0].payload as typeof action.payload,
      ),
    ),
  ).toEqual(after);
});

test("each year books the annual budget and stopping removes future costs without changing past protection", () => {
  const before = ready();
  const after = reducer(before, fund(before));
  const annualCost = wildfirePreparedness(after)!.annualCost;
  const forecast = (game: GameType) =>
    generateNewTimeline(
      game,
      now(game).cash,
      now(game).customers,
      2 * TICKS_PER_YEAR,
    );
  const standard = forecast(before);
  const prepared = forecast(after);
  for (let year = 0; year < 2; year++) {
    const cost = prepared
      .slice(year * TICKS_PER_YEAR, (year + 1) * TICKS_PER_YEAR)
      .reduce(
        (sum, tick, index) =>
          sum +
          tick.expensesOM -
          standard[year * TICKS_PER_YEAR + index].expensesOM,
        0,
      );
    expect(cost).toBeCloseTo(annualCost, 3);
  }
  const later = cloneDeep(after);
  later.date = getDateFromMinute(16 * MINUTES_PER_MONTH, later.startingYear);
  later.timeline = generateNewTimeline(later, 100000000, 1000000);
  const stopped = reducer(
    later,
    chooseScenarioResponse({
      decisionId: wildfirePreparedness(later)!.choice.id,
      optionId: "stop",
    }),
  );
  expect(wildfirePreparedness(stopped)!.active).toBe(false);
  for (const [month, effectiveness] of [
    [16, 1],
    [22, 0.5],
    [28, 0],
  ])
    expect(
      wildfirePreparednessEffectiveness(
        stopped.worldEvents.occurrences,
        "LA",
        month * MINUTES_PER_MONTH,
      ),
    ).toBe(effectiveness);
  expect(activePreparedness(stopped.worldEvents.occurrences, "LA", 15)).toBe(
    true,
  );
  expect(activePreparedness(stopped.worldEvents.occurrences, "LA", 16)).toBe(
    false,
  );
  const control = cloneDeep(stopped);
  control.worldEvents.occurrences = [];
  const off = forecast(stopped);
  const plain = forecast(control);
  expect(off.map((tick) => tick.expensesOM)).toEqual(
    plain.map((tick) => tick.expensesOM),
  );
  expect(
    stopped.meaningfulDecisions.filter((decision) =>
      decision.key.includes("preparedness"),
    ),
  ).toHaveLength(0);
  const restarted = reducer(stopped, fund(stopped));
  expect(wildfirePreparedness(restarted)!.active).toBe(true);
  expect(
    restarted.worldEvents.occurrences
      .filter((event) => event.key.includes(":preparedness:"))
      .map((event) => event.key),
  ).toEqual([
    "wildfire:LA:preparedness:0",
    "wildfire:LA:preparedness:1",
    "wildfire:LA:preparedness:2",
  ]);
});

test("a low-cash run can start, but disabled story effects and replay playback reject changes", () => {
  const poor = ready(0);
  expect(wildfirePreparedness(reducer(poor, fund(poor)))!.active).toBe(true);
  const quiet = ready();
  const action = fund(quiet);
  quiet.storyEffectsDisabled = true;
  expect(reducer(quiet, action)).toBe(quiet);
  const playback = ready();
  playback.replayPlayback = { actions: [], index: 0 };
  expect(reducer(playback, fund(playback))).toBe(playback);
});

test("the preview simulates a typical fire both ways through the real forecast", () => {
  const game = ready();
  const month = wildfirePreviewMonth(game)!;
  // The season's highest-risk month still ahead.
  const { season } = wildfirePreparedness(game)!;
  const weights = Array.from(
    { length: season.endMonth - season.startMonth },
    (_, i) => LA.monthlyWeights[(season.startMonth + i) % 12],
  );
  expect(LA.monthlyWeights[month % 12]).toBe(Math.max(...weights));
  const result = previewWildfire(game, month);
  expect(result.preparedIncident.disconnectedDemand).toBeCloseTo(
    result.standardIncident.disconnectedDemand *
      (1 - result.preparedEffectiveness / 2),
  );
  expect(result.preparedIncident.selectedFacilityIds).toEqual(
    result.standardIncident.selectedFacilityIds,
  );
  // Connected customer demand is higher with preparedness at every point of the day.
  result.preparedDemandW.forEach((w, i) =>
    expect(w).toBeGreaterThan(result.standardDemandW[i]),
  );
  expect(result.noFire.supplyWh).toBeGreaterThan(result.standard.supplyWh);
  expect(result.prepared.supplyWh).toBeGreaterThan(result.standard.supplyWh);
  expect(result.cashBenefit).toBeGreaterThan(0);
  // Simulating never changes the game it was asked about.
  expect(game.worldEvents.active).toEqual([]);
});

test("the program and its change sequence survive event-history trimming", () => {
  const before = ready(100000000, 0);
  const game = cloneDeep(reducer(before, fund(before)));
  game.worldEvents.occurrences[0].key = "wildfire:LA:preparedness:27";
  const budget = wildfirePreparedness(game)!.annualCost;
  for (let i = 0; i < 2401; i++)
    game.worldEvents.occurrences.push({
      key: `old-event:${i}`,
      definitionId: "old-event",
      startsMinute: 0,
      endsMinute: 0,
      attributes: {},
      effects: {},
    });
  while (game.date.monthsElapsed < 1) tickState(game);
  expect(game.worldEvents.occurrences.length).toBeLessThanOrEqual(2400);
  expect(wildfirePreparedness(game)!.active).toBe(true);
  expect(wildfirePreparedness(game)!.annualCost).toBe(budget);
  expect(wildfirePreparedness(game)!.choice.id).toBe(
    "wildfire:LA:preparedness:28",
  );
  expect(
    parseSave(JSON.parse(JSON.stringify(serializeSave(game)))),
  ).not.toBeNull();
});

test("the preview stays within the remaining run and advances to the next season", () => {
  const game = ready();
  game.customScenario!.durationMonths = 8;
  expect(wildfirePreviewMonth(game)).toBe(7);
  game.date = getDateFromMinute(8 * MINUTES_PER_MONTH, game.startingYear);
  expect(wildfirePreviewMonth(game)).toBeUndefined();
  game.customScenario!.durationMonths = 36;
  expect(wildfirePreviewMonth(game)).toBe(20);
});

test("ramps, decays and restarts continuously, including save/load and trimmed history", () => {
  const initial = ready(100000000, 0);
  let game = cloneDeep(reducer(initial, fund(initial)));
  const effectiveness = (month: number) =>
    wildfirePreparednessEffectiveness(
      game.worldEvents.occurrences,
      "LA",
      month * MINUTES_PER_MONTH,
    );
  expect(effectiveness(0)).toBe(0);
  expect(effectiveness(0.5)).toBeCloseTo(1 / 24);
  expect(effectiveness(6)).toBe(0.5);
  expect(effectiveness(12)).toBe(1);
  expect(effectiveness(24)).toBe(1);
  const moveTo = (month: number) => {
    game = cloneDeep(game);
    game.date = getDateFromMinute(month * MINUTES_PER_MONTH, game.startingYear);
    advancePolicies(game, month);
    game.timeline = generateNewTimeline(game, 100000000, 1000000);
  };
  moveTo(6);
  game = reducer(
    game,
    chooseScenarioResponse({
      decisionId: wildfirePreparedness(game)!.choice.id,
      optionId: "stop",
    }),
  );
  expect(effectiveness(6)).toBe(0.5);
  expect(effectiveness(12)).toBe(0.25);
  expect(effectiveness(18)).toBe(0);
  expect(effectiveness(30)).toBe(0);
  moveTo(12);
  const loaded = parseSave(
    JSON.parse(JSON.stringify(serializeSave(game))),
  )!.game;
  expect(wildfirePreparedness(loaded)!.effectiveness).toBe(0.25);
  // Only the latest change is needed after the event log is compacted.
  game.worldEvents.occurrences = game.worldEvents.occurrences.slice(-1);
  expect(effectiveness(12)).toBe(0.25);
  game = reducer(game, fund(game));
  expect(effectiveness(12)).toBe(0.25);
  expect(effectiveness(18)).toBe(0.625);
  expect(effectiveness(24)).toBe(1);
  const preview = previewWildfire(game, 20);
  expect(preview.preparedEffectiveness).toBeCloseTo(0.75);
  expect(preview.standardEffectiveness).toBeCloseTo(0.25 / 3);
});
