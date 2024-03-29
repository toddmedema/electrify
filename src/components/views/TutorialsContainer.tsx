import Redux from 'redux';
import {connect} from 'react-redux';
import {quitGame} from '../../reducers/GameState';
import {navigate} from '../../reducers/Card';
import {AppStateType, GameStateType, StartGameAction} from '../../Types';
import Tutorials, {DispatchProps, StateProps} from './Tutorials';

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    gameState: state.gameState,
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    onBack: () => {
      dispatch(quitGame());
      dispatch(navigate({name: 'MAIN_MENU'}));
    },
    onStart: (delta: Partial<GameStateType>) => {
      dispatch({type: 'GAME_START', delta} as StartGameAction);
    },
  };
};

const TutorialsContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(Tutorials);

export default TutorialsContainer;
