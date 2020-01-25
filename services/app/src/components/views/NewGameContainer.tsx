import {quitGame} from 'app/reducers/GameState';
import {connect} from 'react-redux';
import Redux from 'redux';

import {toCard} from 'app/actions/Card';
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
    },
    onDetails: (delta: Partial<GameStateType>) => {
      dispatch({type: 'GAMESTATE_DELTA', delta});
      dispatch(toCard({name: 'NEW_GAME_DETAILS'}));
    },
    onCustomGame: () => {
      dispatch(toCard({name: 'CUSTOM_GAME'}));
    },
  };
};

const NewGameContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(NewGame);

export default NewGameContainer;
