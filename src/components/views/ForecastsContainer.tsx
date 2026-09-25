import { AppStateType } from "../../Types";
import { connectToStore } from "../base/ConnectToStore";
import Forecasts, { StateProps } from "./Forecasts";

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    game: state.game,
    selectedFacilityId: state.ui.selectedFacilityId,
  };
};

const ForecastsContainer = connectToStore(mapStateToProps)(Forecasts);

export default ForecastsContainer;
