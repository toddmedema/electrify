import Redux from "redux";
import { connect } from "react-redux";
import { navigateBack } from "../../reducers/Card";
import { start, delta } from "../../reducers/Game";
import { AppStateType, GameType } from "../../Types";
import NewGameDetails, { DispatchProps, StateProps } from "./NewGameDetails";

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    game: state.game,
    uid: state.user.uid,
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    onBack: () => {
      dispatch(navigateBack());
    },
    onDelta: (d: Partial<GameType>) => {
      dispatch(delta(d));
    },
    onStart: (d: Partial<GameType>) => {
      dispatch(start(d));
    },
  };
};

const NewGameDetailsContainer = connect(
  mapStateToProps,
  mapDispatchToProps,
)(NewGameDetails);

export default NewGameDetailsContainer;
