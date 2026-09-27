import cloneDeep from "lodash.clonedeep";
import { createGame } from "../testing/Simulator";
import { CUSTOM_SCENARIO_ID, SCENARIOS } from "../data/Scenarios";
import { getWildfireProfile } from "../data/WildfireProfiles";
import { GameType } from "../Types";
import reducer, { generateNewTimeline, setSpeed } from "./Game";
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
import { activePreparedness, wildfirePreparedness } from "../helpers/Wildfire";
import {
  previewWildfire,
  wildfirePreviewMonth,
} from "../helpers/WildfirePreview";

const LA = getWildfireProfile("LA")!;

/** A custom Los Angeles game in April, between fire seasons, with a live forecast. */
function ready(cash = 100000000): GameType {
  const game = createGame({
    scenarioId: CUSTOM_SCENARIO_ID,
    scenario: {
      ...SCENARIOS.find((s) => s.id === 111)!,
      id: CUSTOM_SCENARIO_ID,
      name: "Custom LA",
    },
    seed: 7,
  });
  game.date = getDateFromMinute(3 * MINUTES_PER_MONTH, game.startingYear);
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
  expect(optionalScenarioChoice(game)?.id).toBe(
    `wildfire:LA:${game.date.year}:preparedness`,
  );
  expect(pendingScenarioChoice(game)).toBeUndefined();
  expect(reducer(game, setSpeed("FAST")).speed).toBe("FAST");
});

test("funding charges once, covers the whole season and replays", () => {
  const before = ready();
  const { cost, season } = wildfirePreparedness(before)!;
  expect(cost).toBeGreaterThan(0);
  const action = fund(before);
  const after = reducer(before, action);
  expect(now(after).cash).toBe(now(before).cash - cost);
  expect(wildfirePreparedness(after)!.funded).toBe(true);
  expect(optionalScenarioChoice(after)).toBeUndefined();
  // Funded ahead of time, it covers every month of the season and none outside it.
  const covered = (month: number) =>
    activePreparedness(
      after.worldEvents.occurrences,
      "LA",
      month,
      after.startingYear,
    );
  expect(covered(season.startMonth - 1)).toBe(false);
  expect(covered(season.startMonth)).toBe(true);
  expect(covered(season.endMonth - 1)).toBe(true);
  expect(covered(season.endMonth)).toBe(false);
  // Once per season.
  expect(reducer(after, action)).toBe(after);
  expect(after.replayLog).toEqual([
    {
      minute: before.date.minute,
      type: "chooseScenarioResponse",
      payload: action.payload,
    },
  ]);
  expect(reducer(cloneDeep(before), action)).toEqual(after);
});

test("rejects funding without the cash, without story effects, or in replay playback", () => {
  const poor = ready();
  now(poor).cash = wildfirePreparedness(poor)!.cost - 1;
  expect(reducer(poor, fund(poor))).toBe(poor);
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
    result.standardIncident.disconnectedDemand / 2,
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
