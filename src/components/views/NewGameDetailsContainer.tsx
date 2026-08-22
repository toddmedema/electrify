import type { AppDispatch } from "../../Store";
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

const mapDispatchToProps = (dispatch: AppDispatch): DispatchProps => {
  return {
    onBack: () => {
      dispatch(navigateBack());
    },
    onDelta: (d: Partial<GameType>) => {
      dispatch(delta(d));
    },
    onStart: (scenarioId: number) => {
      dispatch(start(scenarioId));
    },
  };
};

const NewGameDetailsContainer = connect(
  mapStateToProps,
  mapDispatchToProps,
)(NewGameDetails);

export default NewGameDetailsContainer;
