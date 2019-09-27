declare var require: any;
declare var module: any;

import * as React from 'react'
import * as ReactDOM from 'react-dom'
import theme from './Theme'
import MuiThemeProvider from 'material-ui/styles/MuiThemeProvider'
import getMuiTheme from 'material-ui/styles/getMuiTheme'
import {toHome} from './actions/Navigation'
import {getStore} from './Store'
import {getWindow, getGapi, getGA, getDevicePlatform, getDocument, setGA, setupPolyfills} from './Globals'


const injectTapEventPlugin = require('react-tap-event-plugin');

function setupTapEvents() {
  try {
    injectTapEventPlugin();
  } catch (e) {
    console.log('Already injected tap event plugin');
  }
}


export function logEvent(name: string, args: any): void {
  const ga = getGA();
  if (ga) {
    ga('send', 'event', name);
  }
}

function setupDevice() {
  const window = getWindow();

  // Apply class-specific styling
  const platform = getDevicePlatform();
  document.body.className += ' ' + platform;

  if (platform === 'android') {

    // Hide system UI and keep it hidden (Android 4.4+ only)
    window.AndroidFullScreen.immersiveMode(() => {
      console.log('Immersive mode enabled');
    }, () => {
      console.log('Immersive mode failed');
    });

    // Patch for Android browser not properly scrolling to input when keyboard appears
    // https://stackoverflow.com/a/43502958/1332186
    if(/Android/.test(navigator.appVersion)) {
      window.addEventListener('resize', () => {
        if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') {
          document.activeElement.scrollIntoView();
        }
      })
    }
  }

  getDocument().addEventListener('backbutton', () => {
    getStore().dispatch(toHome());
  }, false);

  window.plugins.insomnia.keepAwake(); // keep screen on while app is open
}

function render() {
  // Require is done INSIDE this function to reload app changes.
  const AppContainer = require('./components/AppContainer').default;
  const base = getDocument().getElementById('react-app');
  ReactDOM.unmountComponentAtNode(base);
  ReactDOM.render(
    <MuiThemeProvider muiTheme={getMuiTheme(theme)}>
      <AppContainer/>
    </MuiThemeProvider>,
    base
  );
}

function setupHotReload() {
  if (module.hot) {
    module.hot.accept();
    module.hot.accept('./components/AppContainer', () => {
      setTimeout(() => {render();});
    });
  }
}

declare var ga: any;
function setupGoogleAnalytics() {
  const window = getWindow();
  const document = getDocument();
  // Enable Google Analytics if we're not dev'ing locally
  if (window.location.hostname === 'localhost') {
    return;
  }

  (function(i: any,s: any,o: any,g: any,r: any,a: any,m: any){
    i['GoogleAnalyticsObject']=r;
    i[r]=i[r]||function(){
      (i[r].q=i[r].q||[]).push(arguments)
    },
    i[r].l=1*(new Date() as any);
    a=s.createElement(o),
    m=s.getElementsByTagName(o)[0];
    a.async=1;
    a.src=g;
    m.parentNode.insertBefore(a,m);
  })(window,document,'script','https://www.google-analytics.com/analytics.js','ga',null, null);

  if (typeof ga === 'undefined') {
    console.log('Could not load GA');
    return;
  }
  setGA(ga);
  ga('create', 'UA-47408800-9', 'auto');
  ga('send', 'pageview');
  console.log('google analytics set up');
}

export function init() {
  getWindow().platform = 'web';
  getDocument().addEventListener('deviceready', () => {
    setupDevice();
  }, false);
  setupPolyfills();
  setupTapEvents();
  setupHotReload();
  setupGoogleAnalytics();
  render();
}

// doInit is defined in index.html, but not in tests.
// This lets us setup the environment before initializing, or not init at all.
declare var doInit: boolean;
if (typeof doInit !== 'undefined') {
  init();
}
