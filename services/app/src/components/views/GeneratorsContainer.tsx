import {connect} from 'react-redux';
import Redux from 'redux';
import {AppStateType, BuildGeneratorAction, GeneratorShoppingType, ReprioritizeGeneratorAction, SellGeneratorAction} from '../../Types';
import Generators, {DispatchProps, StateProps} from './Generators';

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    cash: state.gameState.cash,
    generators: state.gameState.generators,
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    onBuildGenerator: (generator: GeneratorShoppingType) => {
      dispatch({type: 'BUILD_GENERATOR', generator} as BuildGeneratorAction);
    },
    onSellGenerator: (id: number) => {
      dispatch({type: 'SELL_GENERATOR', id} as SellGeneratorAction);
    },
    onReprioritizeGenerator: (spotInList: number, delta: number) => {
      dispatch({type: 'REPRIORITIZE_GENERATOR', spotInList, delta} as ReprioritizeGeneratorAction);
    },
  };
};

const GeneratorsContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(Generators);

export default GeneratorsContainer;
