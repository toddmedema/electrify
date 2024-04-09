import Redux from "redux";
import { connect } from "react-redux";
import { delta } from "../../reducers/Game";
import { AppStateType, GameType } from "../../Types";
import Finances, { DispatchProps, StateProps } from "./Finances";

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    game: state.game,
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    onDelta: (d: Partial<GameType>) => {
      dispatch(delta(d));
    },
  };
};

const FinancesContainer = connect(
  mapStateToProps,
  mapDispatchToProps,
)(Finances);

export default FinancesContainer;
