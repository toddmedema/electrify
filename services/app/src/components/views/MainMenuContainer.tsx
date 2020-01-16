import {connect} from 'react-redux';
import Redux from 'redux';
import {toCard} from '../../actions/Card';
import {AppStateType} from '../../Types';
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
      dispatch(toCard({name: 'GAME_SETUP'}));
    },
    onTutorial: () => {
      dispatch({type: 'GAMESTATE_DELTA', delta: {tutorialStep: -2, difficulty: 'TUTORIAL'}});
      dispatch({type: 'GAME_START'});
    },
  };
};

const MainMenuContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(MainMenu);

export default MainMenuContainer;
