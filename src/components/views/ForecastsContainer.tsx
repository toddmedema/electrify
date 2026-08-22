import type { AppDispatch } from "../../Store";
import { connect } from "react-redux";
import { AppStateType } from "../../Types";
import Forecasts, { DispatchProps, StateProps } from "./Forecasts";

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    game: state.game,
  };
};

const mapDispatchToProps = (dispatch: AppDispatch): DispatchProps => {
  return {};
};

const ForecastsContainer = connect(
  mapStateToProps,
  mapDispatchToProps,
)(Forecasts);

export default ForecastsContainer;
