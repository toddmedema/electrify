import {connect} from 'react-redux';
import Redux from 'redux';
import {AppState} from '../../Types';
import Finances, {DispatchProps, StateProps} from './Finances';

const mapStateToProps = (state: AppState): StateProps => {
  return {
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
