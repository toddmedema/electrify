import { connect } from "react-redux";
import Redux from "redux";
import { navigate } from "../../reducers/Card";
import { setSpeed, buildFacility } from "../../reducers/Game";
import { AppStateType, GeneratorShoppingType, SpeedType } from "../../Types";
import BuildGenerators, { DispatchProps, StateProps } from "./BuildGenerators";

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    game: state.game,
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    onBack: () => {
      dispatch(navigate("FACILITIES"));
    },
    onBuildGenerator: (facility: GeneratorShoppingType, financed: boolean) => {
      dispatch(buildFacility({ facility, financed }));
    },
    onSpeedChange: (speed: SpeedType) => {
      dispatch(setSpeed(speed));
    },
  };
};

const BuildGeneratorsContainer = connect(
  mapStateToProps,
  mapDispatchToProps,
)(BuildGenerators);

export default BuildGeneratorsContainer;
