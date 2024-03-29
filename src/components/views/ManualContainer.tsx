import Redux from 'redux';
import {connect} from 'react-redux';
import {toPrevious} from '../../actions/Card';
import {AppStateType} from '../../Types';
import Manual, {DispatchProps, StateProps} from './Manual';

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    onBack: () => {
      dispatch(toPrevious());
    },
  };
};

const ManualContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(Manual);

export default ManualContainer;
