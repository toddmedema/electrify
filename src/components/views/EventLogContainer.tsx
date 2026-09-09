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
import { getDateFromMinute } from "../../helpers/DateTime";
import {
  selectUpcomingStoryEvents,
  UpcomingStoryEventType,
} from "./StoryEventSelectors";

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

const NO_ONGOING: UpcomingStoryEventType[] = [];

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
        startsMinute: event.startsMinute,
        endsMinute: event.endsMinute,
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
    upcoming: selectUpcomingStoryEvents(state),
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
