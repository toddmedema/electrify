import {authWrapper} from 'app/Globals';
import {AppStateType} from 'app/Types';
import {connect} from 'react-redux';
import Redux from 'redux';
import {toCard} from '../../actions/Card';
import MainMenu, {DispatchProps, StateProps} from './MainMenu';

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
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
