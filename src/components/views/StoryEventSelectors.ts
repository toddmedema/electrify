import {
  AppStateType,
  ConceptNameType,
  GameEventImportanceType,
  StoryActionTargetType,
} from "../../Types";
import {
  WILDFIRE_DECISION_KEY,
  STORY_ARC_DEFINITIONS,
  upcomingStoryPhases,
} from "../../data/WorldEvents";
import {
  wildfireRiskNotice,
  WildfireRiskNoticeType,
} from "../../helpers/Wildfire";
import { formatWatts } from "../../helpers/Format";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../../helpers/DateTime";
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
    !game.loadAdditions?.length &&
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
        month.expensesInterest + (month.expensesPolicy || 0),
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
    game.worldEvents.occurrences.find(
      (event) => event.key === WILDFIRE_DECISION_KEY,
    )?.attributes.choice || "standard",
    JSON.stringify(game.loadAdditions),
    historyKey,
    fleetKey,
  ].join("|");
  if (upcomingCache?.key === key) {
    return upcomingCache.events;
  }
  const events: UpcomingStoryEventType[] = upcomingStoryPhases({
    seed: game.seed,
    scenarioId: game.scenarioId,
    difficulty: game.difficulty,
    date: game.date,
    location: game.location,
    occurrences: game.worldEvents.occurrences,
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
  for (const addition of game.loadAdditions ?? []) {
    const startsMinute =
      ((addition.startsYear - game.startingYear) * 12 +
        (addition.startsMonth ?? 1) -
        1) *
      MINUTES_PER_MONTH;
    if (startsMinute <= game.date.minute) continue;
    const date = getDateFromMinute(startsMinute, game.startingYear);
    events.push({
      key: `load:${addition.id}`,
      startsMinute,
      label: `Expected ${date.month} ${date.year}`,
      title: `${addition.label} online`,
      message: `${formatWatts(addition.peakW)} of new ${addition.demandType.toLowerCase()} demand comes online in ${date.month} ${date.year}.`,
      concept: "demand",
      importance: "NOTABLE",
      actionTarget: { card: "INSIGHTS", layer: "SUPPLY_DEMAND" },
    });
  }
  events.sort((a, b) => (a.startsMinute ?? 0) - (b.startsMinute ?? 0));
  upcomingCache = { key, events };
  return events;
}

let riskNoticeCache:
  { key: string; notice: WildfireRiskNoticeType | undefined } | undefined;

/**
 * The seasonal fire-risk notice for the Events pane, or undefined when there is none. Cached by
 * the inputs that can change it (the weather reading is not free to recompute on every render).
 */
export function selectWildfireRiskNotice(
  state: AppStateType,
): WildfireRiskNoticeType | undefined {
  const game = state.game;
  if (!game.inGame) {
    return undefined;
  }
  const key = [
    game.seed,
    game.scenarioId,
    game.location.id,
    game.date.monthsElapsed,
    game.storyEffectsDisabled ? 1 : 0,
    game.wildfireHazardDisabled ? 1 : 0,
  ].join("|");
  if (riskNoticeCache?.key === key) {
    return riskNoticeCache.notice;
  }
  const notice = wildfireRiskNotice(game);
  riskNoticeCache = { key, notice };
  return notice;
}
