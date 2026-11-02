import cloneDeep from "lodash.clonedeep";
import { TICKS_PER_MONTH } from "../Constants";
import type { GameType } from "../Types";
import { LEGACY_SCENARIOS } from "../data/LegacyCampaign";
import { resolveStoryAtDate } from "../data/WorldEvents";
import {
  getDateFromMinute,
  MINUTES_PER_MONTH,
  summarizeTimeline,
} from "../helpers/DateTime";
import { getScenarioLocation } from "../helpers/Locations";
import { recordGameObjectiveMonth } from "../helpers/ObjectiveRules";
import { scenarioRules } from "../helpers/ScenarioRules";
import { buildStorySnapshot } from "../helpers/Story";
import reducer, {
  generateNewTimeline,
  initGame,
  start,
  tickState,
} from "../reducers/Game";
import { loadSimData } from "./SimData";

export function firstCompany(): GameType {
  const scenario = LEGACY_SCENARIOS[0];
  const location = getScenarioLocation(scenario)!;
  loadSimData(location);
  return cloneDeep(
    reducer(
      reducer(undefined, start(scenario.id)),
      initGame({
        facilities: scenario.facilities,
        cash: 1e9,
        customers: 100,
        location,
        seed: 611,
      }),
    ),
  );
}

/** Fabricated public month facts isolate the protocol; the final month uses real ticks. */
export function closingCompany(firstMonthCustomers = 100): GameType {
  const game = firstCompany();
  const row = summarizeTimeline(game.timeline, 1882);
  for (let month = 0; month < 239; month++) {
    game.date = getDateFromMinute((month + 1) * MINUTES_PER_MONTH, 1882);
    const closed = {
      ...row,
      year: 1882 + Math.floor(month / 12),
      month: (month % 12) + 1,
      customers: month === 0 ? firstMonthCustomers : 100,
      cash: 1e9,
    };
    game.monthlyHistory.unshift(closed);
    recordGameObjectiveMonth(game, closed);
    const resolved = resolveStoryAtDate({
      rules: scenarioRules(LEGACY_SCENARIOS[0], game),
      scenarioId: game.scenarioId,
      difficulty: game.difficulty,
      seed: game.seed,
      date: game.date,
      location: game.location,
      snapshot: buildStorySnapshot(
        game.monthlyHistory,
        game.facilities,
        game.date.minute,
      ),
      occurrences: game.worldEvents.occurrences,
    });
    game.worldEvents.occurrences.push(...resolved.occurrences);
    game.worldEvents.active = resolved.active;
  }
  game.timeline = generateNewTimeline(game, 1e9, 100);
  for (let tick = 0; tick < TICKS_PER_MONTH; tick++) tickState(game);
  return game;
}
