import {
  AppStateType,
  ConceptNameType,
  GameEventImportanceType,
  StoryActionTargetType,
} from "../../Types";
import {
  STORY_ARC_DEFINITIONS,
  upcomingStoryPhases,
} from "../../data/WorldEvents";
import { getDateFromMinute } from "../../helpers/DateTime";
import { buildStorySnapshot } from "../../helpers/Story";

export interface UpcomingStoryEventType {
  key: string;
  startsMinute?: number;
  endsMinute?: number;
  label: string;
  title?: string;
  message: string;
  concept?: ConceptNameType;
  importance?: GameEventImportanceType;
  actionTarget?: StoryActionTargetType;
}

let upcomingCache:
  { key: string; events: UpcomingStoryEventType[] } | undefined;
const NO_UPCOMING: UpcomingStoryEventType[] = [];

/** The one presentation-ready source shared by Events and forecast Insights. */
export function selectUpcomingStoryEvents(
  state: AppStateType,
): UpcomingStoryEventType[] {
  const game = state.game;
  if (
    !STORY_ARC_DEFINITIONS.some((arc) => arc.scenarioId === game.scenarioId)
  ) {
    return NO_UPCOMING;
  }
  const fleetKey = game.facilities
    .map((facility) =>
      [
        facility.id,
        facility.name,
        facility.fuel,
        facility.peakW,
        facility.yearsToBuildLeft > 0,
        facility.paused,
        facility.minuteOperational,
      ].join(":"),
    )
    .join("|");
  const historyKey = game.monthlyHistory
    .slice(0, 12)
    .map((month) =>
      [
        month.year,
        month.month,
        month.demandWh,
        month.supplyWh,
        month.revenue,
        month.expensesFuel,
        month.expensesOM,
        month.expensesCarbonFee,
        month.expensesInterest,
        month.peakDemandW,
        Object.entries(month.deliveredWhByFuel)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([fuel, wh]) => `${fuel}:${wh}`)
          .join(","),
      ].join(":"),
    )
    .join("|");
  const key = [
    game.seed,
    game.scenarioId,
    game.difficulty,
    game.date.monthsElapsed,
    game.startingYear,
    game.location.id,
    historyKey,
    fleetKey,
  ].join("|");
  if (upcomingCache?.key === key) {
    return upcomingCache.events;
  }
  const events = upcomingStoryPhases({
    seed: game.seed,
    scenarioId: game.scenarioId,
    difficulty: game.difficulty,
    date: game.date,
    location: game.location,
    snapshot: buildStorySnapshot(
      game.monthlyHistory,
      game.facilities,
      game.date.minute,
    ),
  }).map((event) => {
    const date = getDateFromMinute(event.startsMinute, game.startingYear);
    return {
      ...event,
      label: `Expected ${date.month} ${date.year}`,
    };
  });
  upcomingCache = { key, events };
  return events;
}
