import {connect} from 'react-redux';
import Redux from 'redux';
import {AppStateType, BuildStorageAction, ReprioritizeStorageAction, SellStorageAction, StorageShoppingType} from '../../Types';
import Storage, {DispatchProps, StateProps} from './Storage';

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    gameState: state.gameState,
    cash: (state.gameState.monthlyHistory[0] || {}).cash,
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    onBuildStorage: (storage: StorageShoppingType, financed: boolean) => {
      dispatch({type: 'BUILD_STORAGE', storage, financed} as BuildStorageAction);
    },
    onSellStorage: (id: number) => {
      dispatch({type: 'SELL_STORAGE', id} as SellStorageAction);
    },
    onReprioritizeStorage: (spotInList: number, delta: number) => {
      dispatch({type: 'REPRIORITIZE_STORAGE', spotInList, delta} as ReprioritizeStorageAction);
    },
  };
};

const StorageContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(Storage);

export default StorageContainer;
