import { connect } from "react-redux";
import type { AppDispatch } from "../../Store";
import { delta } from "../../reducers/Game";
import { AppStateType, GameType } from "../../Types";
import Insights, { DispatchProps, StateProps } from "./Insights";

const mapStateToProps = (state: AppStateType): StateProps => ({
  game: state.game,
  selectedFacilityId: state.ui.selectedFacilityId,
});

const mapDispatchToProps = (dispatch: AppDispatch): DispatchProps => ({
  onDelta: (change: Partial<GameType>) => dispatch(delta(change)),
});

export default connect(mapStateToProps, mapDispatchToProps)(Insights);
