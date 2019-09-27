import * as React from 'react'
import {Provider} from 'react-redux'
import Snackbar from 'material-ui/Snackbar'

import BuildScreenContainer from './BuildScreenContainer'
import SimulateScreenContainer from './SimulateScreenContainer'
import SplashScreenContainer from './SplashScreenContainer'
import {closeSnackbar} from '../actions/Snackbar'
import {initialNavigation} from '../reducers/Navigation'
import {initialSnackbar} from '../reducers/Snackbar'
import {AppState, NavigationState, SnackbarState} from '../reducers/StateTypes'
import {getStore} from '../Store'

const ReactCSSTransitionGroup: any = require('react-addons-css-transition-group');

interface MainProps extends React.Props<any> {}

export default class Main extends React.Component<MainProps, {}> {
  state: {
    screen: JSX.Element,
    navigation: NavigationState,
    snackbar: SnackbarState,
  };
  storeUnsubscribeHandle: () => any;

  constructor(props: MainProps) {
    super(props);
    this.state = this.getUpdatedState();
    this.storeUnsubscribeHandle = getStore().subscribe(this.handleChange.bind(this));
  }

  componentWillUnmount() {
    // 2017-08-16: Failing to unsubscribe here is likely to have caused unnecessary references to previous
    // JS objects, which prevents garbage collection and causes runaway memory consumption.
    this.storeUnsubscribeHandle();
  }

  getUpdatedState() {
    const state: AppState = getStore().getState();
    if (state === undefined || this.state === undefined || Object.keys(state).length === 0) {
      return {screen: <SplashScreenContainer/>, navigation: initialNavigation, snackbar: initialSnackbar};
    }

    if (state.snackbar.open !== this.state.snackbar.open) {
      return {...this.state, snackbar: state.snackbar};
    }

    if (this.state && state.navigation.ts === this.state.navigation.ts) {
      return this.state;
    }

    let screen: JSX.Element = null;
    switch(state.navigation.page) {
      case 'HOME':
        state.navigation.transition = 'INSTANT';
        screen = <SplashScreenContainer/>;
        break;
      case 'BUILD':
      case 'GENERATORS':
      case 'RESEARCH':
        screen = <BuildScreenContainer/>;
        break;
      case 'SIMULATE':
        screen = <SimulateScreenContainer/>;
        break;
      default:
        throw new Error('Unknown navigation page ' + state.navigation.page);
    }

    return {screen, navigation: state.navigation, snackbar: state.snackbar};
  }

  handleChange() {
    this.setState(this.getUpdatedState());
  }

  render() {
    const screens: any = [
      <div className="screen" key={this.state.navigation.ts}>
        {this.state.screen}
      </div>
    ];
    return (
      <div className="container">
        <Provider store={getStore()}>
          <ReactCSSTransitionGroup
            transitionName={this.state.navigation.transition || 'NEXT'}
            transitionEnterTimeout={300}
            transitionLeaveTimeout={300}>
            {screens}
            <Snackbar
              className="snackbar"
              open={this.state.snackbar.open}
              message={this.state.snackbar.message}
              autoHideDuration={this.state.snackbar.timeout}
              onRequestClose={() => getStore().dispatch(closeSnackbar())}
            />
          </ReactCSSTransitionGroup>
        </Provider>
      </div>
    );
  }
}
