import {connect} from 'react-redux';
import Redux from 'redux';
import {AppStateType} from '../../Types';
import Demand, {DispatchProps, StateProps} from './Demand';

const mapStateToProps = (state: AppStateType): StateProps => {
  return {
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
  };
};

const DemandContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(Demand);

export default DemandContainer;
