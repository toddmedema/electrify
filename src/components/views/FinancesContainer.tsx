import Redux from 'redux';
import {connect} from 'react-redux';
import {AppStateType, GameStateType} from '../../Types';
import Finances, {DispatchProps, StateProps} from './Finances';

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    gameState: state.gameState,
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
