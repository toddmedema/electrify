import { connect } from "react-redux";
import { AppStateType, StoryActionTargetType } from "../../Types";
import EventLog, { DispatchProps, StateProps } from "./EventLog";
import type { AppDispatch } from "../../Store";
import { markEventsRead } from "../../reducers/Game";
import { focusEvidence, openEvidence } from "../../helpers/Evidence";
import { TickThrottle } from "../../helpers/RenderThrottle";
import { getDateFromMinute } from "../../helpers/DateTime";
import {
  selectUpcomingStoryEvents,
  selectWildfireRiskNotice,
  UpcomingStoryEventType,
} from "./StoryEventSelectors";

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

export const makeMapStateToProps = () => {
  const throttle = new TickThrottle();
  let previous: AppStateType | undefined;
  let presented: StateProps | undefined;
  return (state: AppStateType): StateProps => {
    const game = state.game;
    // The rail is an overview, not a tick display. Keep direct interactions, incidents and
    // month boundaries immediate; FAST/ULTRA can share one presentation every ten ticks.
    if (
      !previous ||
      !presented ||
      (game.speed !== "FAST" && game.speed !== "ULTRA") ||
      game.speed !== previous.game.speed ||
      game.date.monthsElapsed !== previous.game.date.monthsElapsed ||
      game.eventLog !== previous.game.eventLog ||
      game.scenarioId !== previous.game.scenarioId ||
      game.seed !== previous.game.seed ||
      game.inGame !== previous.game.inGame ||
      state.ui.evidenceRequest !== previous.ui.evidenceRequest ||
      throttle.due(game.date.minute, 10)
    ) {
      const ongoing = selectOngoing(state);
      const ongoingKeys = new Set(ongoing.map((event) => event.key));
      presented = {
        game,
        events: game.eventLog.filter(
          (event) =>
            !event.storyPhaseKey || !ongoingKeys.has(event.storyPhaseKey),
        ),
        ongoing,
        upcoming: selectUpcomingStoryEvents(state),
        riskNotice: selectWildfireRiskNotice(state),
      };
      throttle.rendered(game.date.minute);
      previous = state;
    }
    return {
      ...presented,
      evidenceRequest: state.ui.evidenceRequest,
      facilityDragActive: state.ui.facilityDragActive,
    };
  };
};

const mapDispatchToProps = (dispatch: AppDispatch): DispatchProps => ({
  onEvidence: (target) => {
    dispatch(openEvidence(target));
  },
  onEvidenceReady: (request, element) => {
    dispatch(focusEvidence(request, element));
  },
  onOpen: () => dispatch(markEventsRead()),
  onSelect: (target?: StoryActionTargetType) => {
    if (target) {
      dispatch(openEvidence(target));
    }
  },
});

const EventLogContainer = connect(
  makeMapStateToProps,
  mapDispatchToProps,
)(EventLog);

export default EventLogContainer;
