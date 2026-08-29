import { connect } from "react-redux";
import { AppStateType, GameEventType } from "../../Types";
import EventLog, { DispatchProps, StateProps } from "./EventLog";
import type { AppDispatch } from "../../Store";
import { markEventsRead } from "../../reducers/Game";
import { navigate } from "../../reducers/Card";

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    events: state.game.eventLog,
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
