import {toCard} from 'app/actions/Card';
import {connect} from 'react-redux';
import Redux from 'redux';
import {AppStateType, ReprioritizeGeneratorAction, SellGeneratorAction} from '../../Types';
import Generators, {DispatchProps, StateProps} from './Generators';

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    gameState: state.gameState,
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    onBuild: () => {
      dispatch(toCard({name: 'BUILD_GENERATORS', dontRemember: true}));
    },
    onSell: (id: number) => {
      dispatch({type: 'SELL_GENERATOR', id} as SellGeneratorAction);
    },
    onReprioritize: (spotInList: number, delta: number) => {
      dispatch({type: 'REPRIORITIZE_GENERATOR', spotInList, delta} as ReprioritizeGeneratorAction);
    },
  };
};

const GeneratorsContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(Generators);

export default GeneratorsContainer;
