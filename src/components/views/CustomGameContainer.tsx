import {connect} from 'react-redux';
import Redux from 'redux';
import {toPrevious} from '../../actions/Card';
import {openDialog} from '../../actions/UI';
import {AppStateType, DialogType, GameStateType, StartGameAction} from '../../Types';
import CustomGame, {DispatchProps, StateProps} from './CustomGame';

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
    onStart: () => {
      dispatch({type: 'GAME_START'} as StartGameAction);
    },
    openDialog: (dialog: DialogType) => {
      dispatch(openDialog(dialog));
    },
  };
};

const CustomGameContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(CustomGame);

export default CustomGameContainer;
