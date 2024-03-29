import Redux from 'redux';
import {connect} from 'react-redux';
import {authWrapper} from '../../Globals';
import {AppStateType} from '../../Types';
import {navigate} from '../../reducers/Card';
import {change as changeSettings} from '../../reducers/Settings';
import MainMenu, {DispatchProps, StateProps} from './MainMenu';

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    audioEnabled: state.settings.audioEnabled,
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    onAudioChange: (v: boolean) => {
      dispatch(changeSettings({audioEnabled: v}));
    },
    onManual: () => {
      dispatch(navigate({name: 'MANUAL'}));
    },
    onSettings: () => {
      dispatch(navigate({name: 'SETTINGS'}));
    },
    onStart: () => {
      dispatch(navigate({name: 'NEW_GAME'}));
    },
    onTutorial: () => {
      dispatch(navigate({name: 'TUTORIALS'}));
    },
  };
};

const MainMenuContainer = authWrapper(connect(
  mapStateToProps,
  mapDispatchToProps
)(MainMenu));

export default MainMenuContainer;
