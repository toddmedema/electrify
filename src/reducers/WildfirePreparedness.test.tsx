import cloneDeep from "lodash.clonedeep";
import { createGame } from "../testing/Simulator";
import { CUSTOM_SCENARIO_ID, SCENARIOS } from "../data/Scenarios";
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
  wildfirePreparednessAnnualCost,
  wildfirePreparednessEffectiveness,
} from "../helpers/Wildfire";
import {
  previewWildfire,
  wildfirePreviewMonth,
} from "../helpers/WildfirePreview";

/** A custom game with the selected historical wildfire and a live forecast. */
function ready(cash = 100000000, month = 3): GameType {
  const game = createGame({
    scenarioId: CUSTOM_SCENARIO_ID,
    scenario: {
      ...SCENARIOS.find((s) => s.id === 111)!,
      id: CUSTOM_SCENARIO_ID,
      name: "Custom LA",
      eventScenarioIds: [111],
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

test("starting reserves backup immediately with no upfront cost, and saves/replays", () => {
  const before = ready();
  const { annualCost } = wildfirePreparedness(before)!;
  expect(annualCost).toBe(200_000);
  const action = fund(before);
  const after = reducer(before, action);
  expect(now(after).cash).toBe(now(before).cash);
  expect(wildfirePreparedness(after)!.active).toBe(true);
  expect(
    optionalScenarioChoice(after)!.options.map((option) => option.id),
  ).toEqual(["stop"]);
  for (const month of [3, 12, 24, 36])
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
    [16, 0],
    [22, 0],
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

test("the preview compares finite local service through the real forecast without changing the game", () => {
  const game = ready();
  const before = serializeSave(game).game;
  const month = wildfirePreviewMonth(game)!;
  expect(month).toBe(36);
  const result = previewWildfire(game, month);
  expect(result.standard.localBackupWh || 0).toBe(0);
  expect(result.prepared.localBackupWh).toBeCloseTo(3_600_000, 1);
  expect(result.standard.interruptedWh).toBeGreaterThan(
    result.prepared.interruptedWh!,
  );
  expect(result.standard.demandWh).toBe(result.prepared.demandWh);
  expect(result.standard.supplyWh).toBe(result.prepared.supplyWh);
  expect(serializeSave(game).game).toEqual(before);
  expect(previewWildfire(game, month)).toEqual(result);
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

test("the preview stays within the run and ends when the incident starts", () => {
  const game = ready();
  game.customScenario!.durationMonths = 8;
  expect(wildfirePreviewMonth(game)).toBeUndefined();
  game.customScenario!.durationMonths = 60;
  expect(wildfirePreviewMonth(game)).toBe(36);
  game.date = getDateFromMinute(36 * MINUTES_PER_MONTH, game.startingYear);
  expect(wildfirePreviewMonth(game)).toBeUndefined();
});

test("reservation availability changes immediately and its charges expire after the incident month", () => {
  const initial = ready(100000000, 0);
  let game = cloneDeep(reducer(initial, fund(initial)));
  const effectiveness = (month: number) =>
    wildfirePreparednessEffectiveness(
      game.worldEvents.occurrences,
      "LA",
      month * MINUTES_PER_MONTH,
    );
  expect(effectiveness(0)).toBe(1);
  expect(effectiveness(0.5)).toBe(1);
  game.date = getDateFromMinute(6 * MINUTES_PER_MONTH, game.startingYear);
  game.timeline = generateNewTimeline(game, 100000000, 1000000);
  game = cloneDeep(
    reducer(
      game,
      chooseScenarioResponse({
        decisionId: wildfirePreparedness(game)!.choice.id,
        optionId: "stop",
      }),
    ),
  );
  expect(effectiveness(6)).toBe(0);
  expect(effectiveness(12)).toBe(0);
  game = cloneDeep(reducer(game, fund(game)));
  const loaded = parseSave(
    JSON.parse(JSON.stringify(serializeSave(game))),
  )!.game;
  expect(wildfirePreparedness(loaded)!.effectiveness).toBe(1);
  expect(
    wildfirePreparednessAnnualCost(
      game.worldEvents.occurrences,
      "LA",
      36 * MINUTES_PER_MONTH,
    ),
  ).toBe(200_000);
  expect(
    wildfirePreparednessAnnualCost(
      game.worldEvents.occurrences,
      "LA",
      37 * MINUTES_PER_MONTH,
    ),
  ).toBe(0);
  game.date = getDateFromMinute(37 * MINUTES_PER_MONTH, game.startingYear);
  expect(wildfirePreparedness(game)).toBeUndefined();
});

test("smoke-exposed locations alone do not offer the historical response reservation", () => {
  const game = ready();
  game.customScenario!.eventScenarioIds = [];
  expect(wildfirePreparedness(game)).toBeUndefined();
});
