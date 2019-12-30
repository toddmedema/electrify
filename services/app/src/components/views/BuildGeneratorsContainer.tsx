import {toCard} from 'app/actions/Card';
import {connect} from 'react-redux';
import Redux from 'redux';
import {AppStateType, BuildGeneratorAction, GeneratorShoppingType} from '../../Types';
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
      dispatch(toCard({name: 'GENERATORS'}));
    },
    onBuildGenerator: (generator: GeneratorShoppingType, financed: boolean) => {
      dispatch({type: 'BUILD_GENERATOR', generator, financed} as BuildGeneratorAction);
    },
  };
};

const BuildGeneratorsContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(BuildGenerators);

export default BuildGeneratorsContainer;
