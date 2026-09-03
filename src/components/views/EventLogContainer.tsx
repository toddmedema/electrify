import { connect } from "react-redux";
import {
  AppStateType,
  NavigateActionType,
  StoryActionTargetType,
} from "../../Types";
import EventLog, { DispatchProps, StateProps } from "./EventLog";
import type { AppDispatch } from "../../Store";
import { markEventsRead } from "../../reducers/Game";
import { navigate } from "../../reducers/Card";
import {
  STORY_ARC_DEFINITIONS,
  upcomingStoryPhases,
} from "../../data/WorldEvents";
import { buildStorySnapshot } from "../../helpers/Story";
import { getDateFromMinute } from "../../helpers/DateTime";
import { UpcomingStoryEventType } from "./EventLog";

export function navigationForStoryTarget(
  target: StoryActionTargetType,
): NavigateActionType {
  return {
    name:
      target.card === "FACILITIES" && target.view === "BUILD_GENERATORS"
        ? "BUILD_GENERATORS"
        : target.card,
    storyTarget: target,
  };
}

let upcomingCache:
  { key: string; events: UpcomingStoryEventType[] } | undefined;
const NO_UPCOMING: UpcomingStoryEventType[] = [];
const NO_ONGOING: UpcomingStoryEventType[] = [];

function selectUpcoming(state: AppStateType): UpcomingStoryEventType[] {
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

export function selectOngoing(state: AppStateType): UpcomingStoryEventType[] {
  const game = state.game;
  const ongoing = game.worldEvents.active
    .filter(
      (event) =>
        event.endsMinute > game.date.minute && event.message !== undefined,
    )
    .map((event) => {
      const through = getDateFromMinute(
        event.endsMinute - 1,
        game.startingYear,
      );
      return {
        key: event.key,
        label: `Through ${through.month} ${through.year}`,
        title: event.title,
        message: event.message!,
        concept: event.concept,
        importance: event.importance,
        actionTarget: event.actionTarget,
      };
    });
  return ongoing.length > 0 ? ongoing : NO_ONGOING;
}

const mapStateToProps = (state: AppStateType): StateProps => {
  const ongoing = selectOngoing(state);
  const ongoingKeys = new Set(ongoing.map((event) => event.key));
  return {
    // An active story belongs in the status section; its original log row returns to history as
    // soon as the effect expires.
    events: state.game.eventLog.filter(
      (event) => !event.storyPhaseKey || !ongoingKeys.has(event.storyPhaseKey),
    ),
    ongoing,
    upcoming: selectUpcoming(state),
  };
};

const mapDispatchToProps = (dispatch: AppDispatch): DispatchProps => ({
  onOpen: () => dispatch(markEventsRead()),
  onSelect: (target?: StoryActionTargetType) => {
    if (target) {
      dispatch(navigate(navigationForStoryTarget(target)));
    }
  },
});

const EventLogContainer = connect(
  mapStateToProps,
  mapDispatchToProps,
)(EventLog);

export default EventLogContainer;
