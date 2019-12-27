import {connect} from 'react-redux';
import Redux from 'redux';
import {AppStateType, BuildGeneratorAction, GeneratorShoppingType, ReprioritizeGeneratorAction, SellGeneratorAction} from '../../Types';
import Generators, {DispatchProps, StateProps} from './Generators';

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    gameState: state.gameState,
    cash: state.gameState.monthlyHistory[0].cash,
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    onBuildGenerator: (generator: GeneratorShoppingType, financed: boolean) => {
      dispatch({type: 'BUILD_GENERATOR', generator, financed} as BuildGeneratorAction);
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
