declare var require: any;
declare var module: any;

import MuiThemeProvider from '@material-ui/core/styles/MuiThemeProvider';
import 'babel-polyfill';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import {Provider} from 'react-redux';
import * as Redux from 'redux';

import {NODE_ENV, VERSION} from 'shared/schema/Constants';
import {audioSet} from './actions/Audio';
import {changeSettings} from './actions/Settings';
import {openSnackbar} from './actions/Snackbar';
import {UNSUPPORTED_BROWSERS} from './Constants';
import {getDevicePlatform, getDocument, getNavigator, getWindow, setGA} from './Globals';
import {getStorageBoolean} from './LocalStorage';
import {createAppStore, getStore} from './Store';
import theme from './Theme';

import Promise from 'promise-polyfill'; // promise polyfill
import 'whatwg-fetch'; // fetch polyfill
export function setupPolyfills(): void {
  const w = getWindow();
  if (!w.Promise) {
    w.Promise = Promise;
  }
}

const ReactGA = require('react-ga');

// This is necessary to prevent compiler errors until/unless we fix the rest of
// the repo to reference custom-defined action types (similar to how redux-thunk does things)
// TODO: Fix redux types
/* tslint:disable */
export type ThunkAction<R, S = {}, E = {}, A extends Redux.Action<any> = Redux.AnyAction> = (
  dispatch: Redux.Dispatch<A>,
  getState: () => S,
  extraArgument: E
) => R;
declare module 'redux' {
  export interface Dispatch<A extends Redux.Action<any> = Redux.AnyAction> {
    <R, E>(asyncAction: ThunkAction<R, {}, E, A>): R;
  }
}
/* tslint:enable */

function setupDevice() {
  const window = getWindow();
  const platform = getDevicePlatform();
  // Platform-specific styles
  document.body.className += ' ' + platform;
  // Default to audio enabled if not user specified in pre-bundled apps
  // since the audio files are already part of the APK
  // (unless the app is using an old / unsupported browser engine)
  getStore().dispatch(changeSettings({
    audioEnabled: getStorageBoolean('audioEnabled', !UNSUPPORTED_BROWSERS.test(getNavigator().userAgent)),
  }));

  if (platform === 'android') {
    // Hide system UI and keep it hidden (Android 4.4+ only)
    if (window.AndroidFullScreen) {
      window.AndroidFullScreen.immersiveMode(() => {
        // console.log('Immersive mode enabled');
      }, () => {
        // console.error('Immersive mode failed');
      });
    } else {
      // console.warn('Immersive mode not supported on this device');
    }

    // Patch for Android browser not properly scrolling to input when keyboard appears
    // https://stackoverflow.com/a/43502958/1332186
    if (/Android/.test(navigator.appVersion)) {
      window.addEventListener('resize', () => {
        if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
          document.activeElement.scrollIntoView();
        }
      });
    }
  }

  getDocument().addEventListener('backbutton', () => {
    // TODO do something when user tries to go back
  }, false);

  getDocument().addEventListener('pause', () => {
    getStore().dispatch(audioSet({paused: true}));
  }, false);

  getDocument().addEventListener('resume', () => {
    getStore().dispatch(audioSet({paused: false}));
  }, false);

  if (window.plugins !== undefined && window.plugins.insomnia !== undefined) {
    window.plugins.insomnia.keepAwake(); // keep screen on while app is open
  }
}

function setupHotReload() {
  if (module.hot) {
    module.hot.accept();
    module.hot.accept('./components/Compositor', () => {
      setTimeout(() => {render(); });
    });
  }
}

function setupGoogleAnalytics() {
  // disabled during local dev
  if (window.location.hostname === 'localhost' || NODE_ENV === 'dev') {
    setGA({
      event: (): void => { /* mock */ },
      set: (): void => { /* mock */ },
    });
    return console.log('Google Analytics disabled during local dev.');
  }
  ReactGA.initialize('UA-47408800-9', {
    gaOptions: {
      appName: getDevicePlatform(),
      appVersion: VERSION,
    },
    titleCase: false,
  });
  ReactGA.pageview('/');
  setGA(ReactGA);
}

function setupStorage(document: Document) {
  // Alert user if cookies disabled
  // Based on https://github.com/Modernizr/Modernizr/blob/master/feature-detects/cookies.js
  try {
    document.cookie = 'cookietest=1';
    const ret = document.cookie.indexOf('cookietest=') !== -1;
    document.cookie = 'cookietest=1; expires=Thu, 01-Jan-1970 00:00:01 GMT';
    if (!ret) {
      throw new Error('Cookies disabled');
    }
  } catch (err) {
    setTimeout(() => {
      getStore().dispatch(openSnackbar('Please enable cookies for the app to function properly.'));
    }, 0);
  }
}

export function init() {
  const window = getWindow();
  const document = getDocument();

  createAppStore();
  setupStorage(document);

  window.platform = window.cordova ? 'cordova' : 'web';
  window.onpopstate = (e) => {
    // TODO do something when user tries to go back
    e.preventDefault();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      getStore().dispatch(audioSet({paused: true}));
    } else if (document.visibilityState === 'visible') {
      getStore().dispatch(audioSet({paused: false}));
    }
  }, false);

  // Only triggers on app builds
  document.addEventListener('deviceready', setupDevice, false);

  setupPolyfills();
  setupGoogleAnalytics(); // before anything else that might log in the user
  setupHotReload();

  render();

  // Wait to process settings & dispatch additional UI until render complete
  if (UNSUPPORTED_BROWSERS.test(getNavigator().userAgent)) {
    // getStore().dispatch(setServerStatus({
    //   announcement: {
    //     open: true,
    //     message: 'Unknown browser. Please use a standard browser like Chrome or Firefox for the best experience.',
    //   },
    // }));
  }
}

function render() {
  // Require is done INSIDE this function to reload app changes.
  const CompositorContainer = require('./components/CompositorContainer').default;
  const base = getDocument().getElementById('react-app');
  if (!base) {
    throw new Error('Could not find react-app element');
  }
  ReactDOM.unmountComponentAtNode(base);
  ReactDOM.render(
    <MuiThemeProvider theme={theme}>
      <Provider store={getStore()}>
        <CompositorContainer store={getStore()}/>
      </Provider>
    </MuiThemeProvider>,
    base
  );
}

// doInit is defined in index.html, but not in tests.
// This lets us setup the environment before initializing, or not init at all.
declare var doInit: boolean;
if (typeof doInit !== 'undefined') {
  // Catch and display + log all errors
  init();
}
