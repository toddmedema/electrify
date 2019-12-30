import {toCard} from 'app/actions/Card';
import {connect} from 'react-redux';
import Redux from 'redux';
import {AppStateType, BuildStorageAction, StorageShoppingType} from '../../Types';
import BuildStorage, {DispatchProps, StateProps} from './BuildStorage';

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    gameState: state.gameState,
    cash: (state.gameState.monthlyHistory[0] || {}).cash,
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    onBack: () => {
      dispatch(toCard({name: 'STORAGE'}));
    },
    onBuildStorage: (storage: StorageShoppingType, financed: boolean) => {
      dispatch({type: 'BUILD_STORAGE', storage, financed} as BuildStorageAction);
    },
  };
};

const BuildStorageContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(BuildStorage);

export default BuildStorageContainer;
