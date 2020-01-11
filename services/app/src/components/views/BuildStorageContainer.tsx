import {toCard} from 'app/actions/Card';
import {connect} from 'react-redux';
import Redux from 'redux';
import {AppStateType, BuildFacilityAction, StorageShoppingType} from '../../Types';
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
      dispatch(toCard({name: 'FACILITIES'}));
    },
    onBuildStorage: (facility: StorageShoppingType, financed: boolean) => {
      dispatch({type: 'BUILD_FACILITY', facility, financed} as BuildFacilityAction);
    },
  };
};

const BuildStorageContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(BuildStorage);

export default BuildStorageContainer;
