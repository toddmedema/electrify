import Redux from 'redux';
import {connect} from 'react-redux';
import {toPrevious} from '../../actions/Card';
import {authWrapper} from '../../Globals';
import {AppStateType, GameStateType, StartGameAction} from '../../Types';
import NewGameDetails, {DispatchProps, StateProps} from './NewGameDetails';

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    gameState: state.gameState,
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    onBack: () => {
      dispatch(toPrevious());
    },
    onDelta: (delta: Partial<GameStateType>) => {
      dispatch({type: 'GAMESTATE_DELTA', delta});
    },
    onStart: (delta: Partial<GameStateType>) => {
      dispatch({type: 'GAME_START', delta} as StartGameAction);
    },
  };
};

const NewGameDetailsContainer = authWrapper(connect(
  mapStateToProps,
  mapDispatchToProps
)(NewGameDetails));

export default NewGameDetailsContainer;
