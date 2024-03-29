import {connect} from 'react-redux';
import Redux from 'redux';
import {navigate} from '../../reducers/Card';
import {setSpeed} from '../../reducers/GameState';
import {AppStateType, BuildFacilityAction, SpeedType, StorageShoppingType} from '../../Types';
import BuildStorage, {DispatchProps, StateProps} from './BuildStorage';

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    gameState: state.gameState,
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    onBack: () => {
      dispatch(navigate({name: 'FACILITIES'}));
    },
    onBuildStorage: (facility: StorageShoppingType, financed: boolean) => {
      dispatch({type: 'BUILD_FACILITY', facility, financed} as BuildFacilityAction);
    },
    onSpeedChange: (speed: SpeedType) => {
      dispatch(setSpeed(speed));
    },
  };
};

const BuildStorageContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(BuildStorage);

export default BuildStorageContainer;
