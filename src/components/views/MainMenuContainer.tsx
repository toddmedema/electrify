import Redux from 'redux';
import {connect} from 'react-redux';
import {authWrapper} from '../../Globals';
import {AppStateType} from '../../Types';
import {toCard} from '../../actions/Card';
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
      dispatch(toCard({name: 'MANUAL'}));
    },
    onSettings: () => {
      dispatch(toCard({name: 'SETTINGS'}));
    },
    onStart: () => {
      dispatch(toCard({name: 'NEW_GAME'}));
    },
    onTutorial: () => {
      dispatch(toCard({name: 'TUTORIALS'}));
    },
  };
};

const MainMenuContainer = authWrapper(connect(
  mapStateToProps,
  mapDispatchToProps
)(MainMenu));

export default MainMenuContainer;
