import {quitGame} from 'app/reducers/GameState';
import {connect} from 'react-redux';
import Redux from 'redux';
import {openDialog} from '../../actions/UI';
import {AppStateType, DialogType, GameStateType} from '../../Types';
import GameSetup, {DispatchProps, StateProps} from './GameSetup';

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
    onDelta: (delta: Partial<GameStateType>) => {
      dispatch({type: 'GAMESTATE_DELTA', delta});
    },
    onStart: () => {
      dispatch({type: 'GAME_START'});
    },
    openDialog: (dialog: DialogType) => {
      dispatch(openDialog(dialog));
    },
  };
};

const GameSetupContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(GameSetup);

export default GameSetupContainer;
