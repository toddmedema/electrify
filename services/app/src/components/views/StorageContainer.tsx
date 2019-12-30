import {toCard} from 'app/actions/Card';
import {connect} from 'react-redux';
import Redux from 'redux';
import {AppStateType, ReprioritizeStorageAction, SellStorageAction} from '../../Types';
import Storage, {DispatchProps, StateProps} from './Storage';

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    gameState: state.gameState,
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    onBuild: () => {
      dispatch(toCard({name: 'BUILD_STORAGE', dontRemember: true}));
    },
    onSell: (id: number) => {
      dispatch({type: 'SELL_STORAGE', id} as SellStorageAction);
    },
    onReprioritize: (spotInList: number, delta: number) => {
      dispatch({type: 'REPRIORITIZE_STORAGE', spotInList, delta} as ReprioritizeStorageAction);
    },
  };
};

const StorageContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(Storage);

export default StorageContainer;
