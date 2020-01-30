import {connect} from 'react-redux';
import Redux from 'redux';
import {AppStateType, GameStateType} from '../../Types';
import Finances, {DispatchProps, StateProps} from './Finances';

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    gameState: state.gameState,
    date: state.gameState.date,
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    onDelta: (delta: Partial<GameStateType>) => {
      dispatch({type: 'GAMESTATE_DELTA', delta});
    },
  };
};

const FinancesContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(Finances);

export default FinancesContainer;
