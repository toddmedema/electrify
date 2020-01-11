import {toCard} from 'app/actions/Card';
import {connect} from 'react-redux';
import Redux from 'redux';
import {AppStateType, BuildFacilityAction, GeneratorShoppingType} from '../../Types';
import BuildGenerators, {DispatchProps, StateProps} from './BuildGenerators';

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    gameState: state.gameState,
    cash: (state.gameState.monthlyHistory[0] || {}).cash,
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
  };
};

const BuildGeneratorsContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(BuildGenerators);

export default BuildGeneratorsContainer;
