import {connect} from 'react-redux';
import Redux from 'redux';
import {toCard} from '../../actions/Card';
import {AppState} from '../../Types';
import Simulate, {DispatchProps, StateProps} from './Simulate';

const mapStateToProps = (state: AppState): StateProps => {
  return {
  };
};

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>): DispatchProps => {
  return {
    onNextSeason: () => {
      // TODO "next season" action
      dispatch(toCard({name: 'GENERATORS'}));
    },
  };
};

const SimulateContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(Simulate);

export default SimulateContainer;
