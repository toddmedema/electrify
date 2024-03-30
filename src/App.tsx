import { ThemeProvider, StyledEngineProvider } from '@mui/material/styles';
import {Provider} from 'react-redux';
import * as Redux from 'redux';
import CompositorContainer from './components/CompositorContainer';
import {pause, resume} from './data/Audio';
import {navigateBack} from './reducers/Card';
import {openSnackbar} from './actions/UI';
import {firebaseAppAuth, getDevicePlatform} from './Globals';
import {delta} from './reducers/User';
import {store} from './Store';
import theme from './Theme';

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
  const platform = getDevicePlatform();
  // Platform-specific styles
  document.body.className += ' ' + platform;

  document.addEventListener('backbutton', () => {
    store.dispatch(navigateBack());
  }, false);

  document.addEventListener('pause', () => {
    pause();
  }, false);

  document.addEventListener('resume', () => {
    resume();
  }, false);
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
      store.dispatch(openSnackbar('Please enable cookies for the app to function properly.'));
    }, 0);
  }
}

export default function App() {
  setupStorage(document);

  window.onpopstate = (e) => {
    store.dispatch(navigateBack());
    e.preventDefault();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      pause();
    } else if (document.visibilityState === 'visible') {
      resume();
    }
  }, false);

  firebaseAppAuth.onAuthStateChanged((user: any) => {
    store.dispatch(delta({uid: (user||{}).uid}));
  });

  // Only triggers on app builds
  document.addEventListener('deviceready', setupDevice, false);

  return render();
}

function render() {
  return <StyledEngineProvider injectFirst>
    <ThemeProvider theme={theme}>
      <Provider store={store}>
        <CompositorContainer store={store}/>
      </Provider>
    </ThemeProvider>
  </StyledEngineProvider>;
}
