import {toCard} from 'app/actions/Card';
import {connect} from 'react-redux';
import Redux from 'redux';
import {AppStateType, ReprioritizeGeneratorAction, ReprioritizeStorageAction, SellGeneratorAction, SellStorageAction} from '../../Types';
import Facilities, {DispatchProps, StateProps} from './Facilities';

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    gameState: state.gameState,
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    onGeneratorBuild: () => {
      dispatch(toCard({name: 'BUILD_GENERATORS', dontRemember: true}));
    },
    onGeneratorSell: (id: number) => {
      dispatch({type: 'SELL_GENERATOR', id} as SellGeneratorAction);
    },
    onGeneratorReprioritize: (spotInList: number, delta: number) => {
      dispatch({type: 'REPRIORITIZE_GENERATOR', spotInList, delta} as ReprioritizeGeneratorAction);
    },
    onStorageBuild: () => {
      dispatch(toCard({name: 'BUILD_STORAGE', dontRemember: true}));
    },
    onStorageSell: (id: number) => {
      dispatch({type: 'SELL_STORAGE', id} as SellStorageAction);
    },
    onStorageReprioritize: (spotInList: number, delta: number) => {
      dispatch({type: 'REPRIORITIZE_STORAGE', spotInList, delta} as ReprioritizeStorageAction);
    },
  };
};

const FacilitiesContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(Facilities);

export default FacilitiesContainer;
