import Redux from 'redux';
import {connect} from 'react-redux';
import {quitGame} from '../../reducers/GameState';
import {navigate} from '../../reducers/Card';
import {AppStateType, GameStateType} from '../../Types';
import NewGame, {DispatchProps, StateProps} from './NewGame';

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
    onDetails: (delta: Partial<GameStateType>) => {
      dispatch({type: 'GAMESTATE_DELTA', delta});
      dispatch(navigate({name: 'NEW_GAME_DETAILS'}));
    },
    onCustomGame: () => {
      dispatch(navigate({name: 'CUSTOM_GAME'}));
    },
  };
};

const NewGameContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(NewGame);

export default NewGameContainer;
