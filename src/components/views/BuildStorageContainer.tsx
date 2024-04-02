import {connect} from 'react-redux';
import Redux from 'redux';
import {navigate} from '../../reducers/Card';
import {setSpeed} from '../../reducers/Game';
import {buildFacility} from '../../reducers/Game';
import {AppStateType, SpeedType, StorageShoppingType} from '../../Types';
import BuildStorage, {DispatchProps, StateProps} from './BuildStorage';

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    game: state.game,
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    onBack: () => {
      dispatch(navigate('FACILITIES'));
    },
    onBuildStorage: (facility: StorageShoppingType, financed: boolean) => {
      dispatch(buildFacility({facility, financed}));
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
