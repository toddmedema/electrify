import { customEventContext } from "../../helpers/CustomScenarioEvents";
import {
  AppStateType,
  ConceptNameType,
  GameEventImportanceType,
  StoryActionTargetType,
} from "../../Types";
import { upcomingStoryPhases } from "../../data/WorldEvents";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../../helpers/DateTime";
import { buildStorySnapshot } from "../../helpers/Story";
import {
  scenarioRules,
  scenarioRulesIdentity,
} from "../../helpers/ScenarioRules";
import { getScenario } from "../../data/Scenarios";
import { scenarioChoicesForGame } from "../../helpers/ScenarioChoices";
import {
  ruleConditionMet,
  scenarioRuleForecastOccurrences,
} from "../../helpers/ScenarioRuleRuntime";

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
  const rules = scenarioRules(
    getScenario(game.scenarioId, game.customScenario),
    game,
  );
  const customEvents = customEventContext(game.customScenario);
  if (!game.loadAdditions?.length && !rules && !customEvents?.length)
    return NO_UPCOMING;
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
    game.customScenario?.mod?.runtimeDigest ??
      scenarioRulesIdentity(
        scenarioRules(getScenario(game.scenarioId, game.customScenario), game),
      ),
    game.scenarioId,
    game.difficulty,
    game.date.monthsElapsed,
    game.startingYear,
    game.location.id,
    JSON.stringify(game.loadAdditions),
    JSON.stringify(customEvents),
    JSON.stringify(
      game.worldEvents.occurrences.map((event) => [
        event.key,
        event.startsMinute,
        event.attributes.choice,
        event.attributes.ruleTargets,
        event.attributes.startEffectiveness,
      ]),
    ),
    historyKey,
    fleetKey,
  ].join("|");
  if (upcomingCache?.key === key) {
    return upcomingCache.events;
  }
  const events: UpcomingStoryEventType[] = upcomingStoryPhases({
    rules: scenarioRules(
      getScenario(game.scenarioId, game.customScenario),
      game,
    ),
    seed: game.seed,
    scenarioId: game.scenarioId,
    customEvents,
    difficulty: game.difficulty,
    date: game.date,
    location: game.location,
    occurrences: rules
      ? scenarioRuleForecastOccurrences(
          rules,
          game.worldEvents.occurrences,
          rules.durationMonths - 1,
        )
      : game.worldEvents.occurrences,
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
  const choiceContext = scenarioChoicesForGame(game);
  for (const choice of choiceContext.choices) {
    if (
      choice.dueMonth < game.date.monthsElapsed ||
      game.worldEvents.occurrences.some((event) => event.key === choice.key) ||
      (choice.requiresChoice &&
        (!choiceContext.rules ||
          !ruleConditionMet(
            choice.requiresChoice,
            choiceContext.rules,
            game.worldEvents.occurrences,
          )))
    )
      continue;
    const startsMinute = choice.dueMonth * MINUTES_PER_MONTH;
    const date = getDateFromMinute(startsMinute, game.startingYear);
    const free = choice.options.find(
      (option) => option.id === choice.freeOptionId,
    )!;
    events.push({
      key: choice.key,
      startsMinute,
      label: choice.automatic
        ? `Automatic response · ${date.month} ${date.year}`
        : startsMinute === game.date.minute
          ? "Decision required · Paused"
          : `Decision · ${date.month} ${date.year}`,
      title: choice.title,
      message: choice.automatic
        ? `This will resolve automatically: ${free.label}. ${free.description}`
        : choice.prompt,
      concept: "goal",
      importance: "NOTABLE",
      actionTarget: { card: "EVENTS" },
    });
  }
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
      title: `${addition.label} coming online`,
      message: "Demand rising as new load connects.",
      concept: "demand",
      importance: "NOTABLE",
      actionTarget: { card: "INSIGHTS", layer: "SUPPLY_DEMAND" },
    });
  }
  events.sort((a, b) => (a.startsMinute ?? 0) - (b.startsMinute ?? 0));
  upcomingCache = { key, events };
  return events;
}

/** Occurrences of one ongoing event, e.g. hail at four plants, summarised for the status bar. */
export interface ActiveEventGroupType {
  key: string;
  title: string;
  concept?: ConceptNameType;
  importance: GameEventImportanceType;
  count: number;
  throughLabel: string;
}

const IMPORTANCE_RANK: Record<GameEventImportanceType, number> = {
  CRITICAL: 0,
  NOTABLE: 1,
  ROUTINE: 2,
};
const NO_ACTIVE_GROUPS: ActiveEventGroupType[] = [];
let activeGroupsCache:
  { key: string; groups: ActiveEventGroupType[] } | undefined;

/**
 * The critical and notable events in effect right now, grouped by title and most severe first.
 * Routine ones, such as a years-long drift in gas prices, stay in the Events pane so the status
 * bar only speaks up for something worth a glance. It reads this every tick, so it hands back
 * the same array until an event starts or ends.
 */
export function selectActiveEventGroups(
  state: AppStateType,
): ActiveEventGroupType[] {
  const game = state.game;
  const now = game.date.minute;
  const inEffect = game.worldEvents.active.filter(
    (event) =>
      event.startsMinute <= now &&
      event.endsMinute > now &&
      event.message !== undefined &&
      (event.importance === "CRITICAL" || event.importance === "NOTABLE"),
  );
  if (inEffect.length === 0) {
    return NO_ACTIVE_GROUPS;
  }
  const cacheKey =
    game.startingYear + "|" + inEffect.map((event) => event.key).join("|");
  if (activeGroupsCache?.key === cacheKey) {
    return activeGroupsCache.groups;
  }

  const byTitle = new Map<
    string,
    { group: ActiveEventGroupType; startsMinute: number; endsMinute: number }
  >();
  for (const event of inEffect) {
    const title = event.title ?? event.key;
    const importance = event.importance!;
    const existing = byTitle.get(title);
    if (!existing) {
      byTitle.set(title, {
        group: {
          key: event.key,
          title,
          concept: event.concept,
          importance,
          count: 1,
          throughLabel: "",
        },
        startsMinute: event.startsMinute,
        endsMinute: event.endsMinute,
      });
      continue;
    }
    existing.group.count += 1;
    if (
      IMPORTANCE_RANK[importance] < IMPORTANCE_RANK[existing.group.importance]
    ) {
      existing.group.importance = importance;
    }
    existing.startsMinute = Math.max(existing.startsMinute, event.startsMinute);
    existing.endsMinute = Math.max(existing.endsMinute, event.endsMinute);
  }

  const groups = Array.from(byTitle.values())
    .sort(
      (a, b) =>
        IMPORTANCE_RANK[a.group.importance] -
          IMPORTANCE_RANK[b.group.importance] ||
        b.startsMinute - a.startsMinute ||
        a.group.key.localeCompare(b.group.key),
    )
    .map(({ group, endsMinute }) => {
      const through = getDateFromMinute(endsMinute - 1, game.startingYear);
      return {
        ...group,
        throughLabel: `through ${through.month} ${through.year}`,
      };
    });
  activeGroupsCache = { key: cacheKey, groups };
  return groups;
}
