import {connect} from 'react-redux';
import Redux from 'redux';
import {toCard} from '../../actions/Card';
import {setSpeed} from '../../reducers/GameState';
import {AppStateType, BuildFacilityAction, GeneratorShoppingType, SpeedType} from '../../Types';
import BuildGenerators, {DispatchProps, StateProps} from './BuildGenerators';

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    gameState: state.gameState,
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    onBack: () => {
      dispatch(toCard({name: 'FACILITIES'}));
    },
    onBuildGenerator: (facility: GeneratorShoppingType, financed: boolean) => {
      dispatch({type: 'BUILD_FACILITY', facility, financed} as BuildFacilityAction);
    },
    onSpeedChange: (speed: SpeedType) => {
      dispatch(setSpeed(speed));
    },
  };
};

const BuildGeneratorsContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(BuildGenerators);

export default BuildGeneratorsContainer;
