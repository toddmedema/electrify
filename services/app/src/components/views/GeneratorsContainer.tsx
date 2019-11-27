import {connect} from 'react-redux';
import Redux from 'redux';
import {AppState} from '../../reducers/StateTypes';
import Generators, {DispatchProps, StateProps} from './Generators';

const mapStateToProps = (state: AppState): StateProps => {
  return {
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
  };
};

const GeneratorsContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(Generators);

export default GeneratorsContainer;
