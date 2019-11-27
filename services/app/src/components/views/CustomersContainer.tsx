import {connect} from 'react-redux';
import Redux from 'redux';
import {AppState} from '../../reducers/StateTypes';
import Customers, {DispatchProps, StateProps} from './Customers';

const mapStateToProps = (state: AppState): StateProps => {
  return {
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
  };
};

const CustomersContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(Customers);

export default CustomersContainer;
