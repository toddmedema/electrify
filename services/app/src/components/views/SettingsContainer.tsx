import {connect} from 'react-redux';
import Redux from 'redux';
import {toCard} from '../../actions/Card';
import {changeSettings} from '../../actions/Settings';
import {AppStateType} from '../../Types';
import Settings, {DispatchProps, StateProps} from './Settings';

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    settings: state.settings,
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    onAudioChange: (v: boolean) => {
      dispatch(changeSettings({audioEnabled: v}));
    },
    onExperimentalChange: (v: boolean) => {
      dispatch(changeSettings({experimental: v}));
    },
    onBack: () => {
      dispatch(toCard({name: 'MAIN_MENU'}));
    },
    onShowHelpChange: (v: boolean) => {
      dispatch(changeSettings({showHelp: v}));
    },
    onVibrationChange: (v: boolean) => {
      dispatch(changeSettings({vibration: v}));
    },
  };
};

const SettingsContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(Settings);

export default SettingsContainer;
