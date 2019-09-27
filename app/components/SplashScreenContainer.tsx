import Redux from 'redux'
import {connect} from 'react-redux'
import {toPage} from '../actions/Navigation'
import {AppState} from '../reducers/StateTypes'
import SplashScreen, {SplashScreenStateProps, SplashScreenDispatchProps} from './SplashScreen'

declare var window:any;

const mapStateToProps = (state: AppState, ownProps: any): SplashScreenStateProps => {
  return {};
}

const mapDispatchToProps = (dispatch: Redux.Dispatch<any>, ownProps: any): SplashScreenDispatchProps => {
  return {
    onAdTap: () => {
console.log('TODO');
      window.open('http://expeditiongame.com?utm_source=electrify-app', '_system');
    },
    onContinueTap: () => {
console.log('TODO load game state from storage');
      dispatch(toPage('GENERATORS'));
    },
    onPlayTap: () => {
// TODO show a dialog, 'Welcome, new CEO of <company.name>'
// Potentially even get to pick between a few (regions and/or companies)
// With different weather patterns, starting assets and research, etc
// ^^ Perhaps even different countries / regulations?
      dispatch(toPage('GENERATORS'));
    },
    onTutorialTap: () => {
console.log('TODO');
    },
  };
}

const SplashScreenContainer = connect(
  mapStateToProps,
  mapDispatchToProps
)(SplashScreen);

export default SplashScreenContainer
