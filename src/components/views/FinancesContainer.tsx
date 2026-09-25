import type { AppDispatch } from "../../Store";
import { connectToStore } from "../base/ConnectToStore";
import { delta } from "../../reducers/Game";
import { AppStateType, GameType } from "../../Types";
import Finances, { DispatchProps, StateProps } from "./Finances";

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    game: state.game,
    selectedFacilityId: state.ui.selectedFacilityId,
  };
};

const mapDispatchToProps = (dispatch: AppDispatch): DispatchProps => {
  return {
    onDelta: (d: Partial<GameType>) => {
      dispatch(delta(d));
    },
  };
};

const FinancesContainer = connectToStore(
  mapStateToProps,
  mapDispatchToProps,
)(Finances);

export default FinancesContainer;
