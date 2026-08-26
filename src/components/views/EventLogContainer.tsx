import { connect } from "react-redux";
import { AppStateType, GameEventType } from "../../Types";
import EventLog, { StateProps } from "./EventLog";

// One shared array for a run with nothing in its log yet - and for a save written before the log
// existed. A fresh [] per call would be a new prop every tick, which is a re-render every tick
const NO_EVENTS: GameEventType[] = [];

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    events: state.game.eventLog || NO_EVENTS,
  };
};

const EventLogContainer = connect(mapStateToProps)(EventLog);

export default EventLogContainer;
