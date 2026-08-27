import { connect } from "react-redux";
import { AppStateType, GameEventType } from "../../Types";
import EventLog, { DispatchProps, StateProps } from "./EventLog";
import type { AppDispatch } from "../../Store";
import { markEventsRead } from "../../reducers/Game";
import { navigate } from "../../reducers/Card";

// One shared array for a run with nothing in its log yet - and for a save written before the log
// existed. A fresh [] per call would be a new prop every tick, which is a re-render every tick
const NO_EVENTS: GameEventType[] = [];

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    events: state.game.eventLog || NO_EVENTS,
  };
};

const mapDispatchToProps = (dispatch: AppDispatch): DispatchProps => ({
  onOpen: () => dispatch(markEventsRead()),
  onSelect: (event: GameEventType) => {
    if (event.actionTarget) {
      dispatch(navigate(event.actionTarget));
    }
  },
});

const EventLogContainer = connect(
  mapStateToProps,
  mapDispatchToProps,
)(EventLog);

export default EventLogContainer;
