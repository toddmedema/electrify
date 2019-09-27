import Redux from 'redux'
import {connect} from 'react-redux'
import {toPage} from '../actions/Navigation'
import {AppState} from '../reducers/StateTypes'
import SimulateScreen, {SimulateScreenStateProps, SimulateScreenDispatchProps} from './SimulateScreen'

declare var window:any;

const mapStateToProps = (state: AppState, ownProps: any): SimulateScreenStateProps => {
  return {};
}

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>, ownProps: any): SimulateScreenDispatchProps => {
  return {
    onBuildTap: () => {
      dispatch(toPage('BUILD'));
    },
  };
}

const SimulateScreenContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(SimulateScreen);

export default SimulateScreenContainer
