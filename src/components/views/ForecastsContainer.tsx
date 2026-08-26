import { connect } from "react-redux";
import { AppStateType } from "../../Types";
import Forecasts, { StateProps } from "./Forecasts";

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    game: state.game,
    selectedFacilityId: state.ui.selectedFacilityId,
  };
};

const ForecastsContainer = connect(mapStateToProps)(Forecasts);

export default ForecastsContainer;
