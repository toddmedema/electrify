import {connect} from 'react-redux';
import Redux from 'redux';
import {AppStateType} from '../../Types';
import Finances, {DispatchProps, StateProps} from './Finances';

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
    gameState: state.gameState,
    date: state.gameState.date,
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
  };
};

const FinancesContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(Finances);

export default FinancesContainer;
