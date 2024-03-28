declare var device: any;
declare var ga: any;
declare var gapi: any;

import 'firebase/analytics';
import * as firebase from 'firebase/app';
import 'firebase/auth';
import 'firebase/firestore';
import withFirebaseAuth from 'react-with-firebase-auth';

const firebaseApp = firebase.initializeApp({
  apiKey: 'AIzaSyBCZX3pfJe65LU1Ei_ONj6Yw2eaMKsZX7g',
  authDomain: 'electrify-game.firebaseapp.com',
  databaseURL: 'https://electrify-game.firebaseio.com',
  projectId: 'electrify-game',
  storageBucket: 'electrify-game.appspot.com',
  messagingSenderId: '882673691459',
  appId: '1:882673691459:web:b6af63afe7ddf377a31df6',
  measurementId: 'G-M064W1XFDY',
});
export const firebaseAppAuth = firebaseApp.auth();
const providers = {
  googleProvider: new firebase.auth.GoogleAuthProvider(),
};
const firebaseAppAnalytics = firebaseApp.analytics();

export interface ReactDocument extends Document {
  addEventListener: (e: string, f: (this: any, ev: MouseEvent) => any,
                     useCapture?: boolean) => void;
  dispatchEvent: (e: Event) => boolean;
}

export interface ReactWindow extends Window {
  platform?: string;
  VERSION?: string;
  AudioContext?: AudioContext;
  webkitAudioContext?: AudioContext;
  Promise?: any;
  test?: boolean;
  device?: {platform: string};
}
declare var window: ReactWindow;

const refs = {
  cheerio: require('cheerio') as CheerioAPI,
  device: (typeof device !== 'undefined') ? device : {platform: null},
  db: null as any,
  document,
  ga: (typeof ga !== 'undefined') ? ga : null,
  gapi: (typeof gapi !== 'undefined') ? gapi : null,
  history: (typeof history !== 'undefined') ? history : {pushState: () => null},
  localStorage: null as (Storage|null),
  navigator: (typeof navigator !== 'undefined') ? navigator : null,
  window,
  audioContext: null,
};

export function logEvent(eventName: string, args?: object): void {
  firebaseAppAnalytics.logEvent(eventName, args);
}

export function authWrapper(component: any): any {
  return withFirebaseAuth({
    providers,
    firebaseAppAuth,
  })(component);
}

export function getDb(): any {
  if (!refs.db) {
    refs.db = firebase.firestore();
    refs.db.enablePersistence()
      .catch((err: any) => {
          if (err.code === 'failed-precondition') {
            // Multiple tabs open, persistence can only be enabled in one tab at a a time.
          } else if (err.code === 'unimplemented') {
            // The current browser does not support all of the
            // features required to enable persistence
          }
      });
  }
  return refs.db;
}

export function getDevicePlatform(): 'web' {
  return 'web';
}

// https://stackoverflow.com/questions/1038727/how-to-get-browser-width-using-javascript-code
export function isSmallScreen(): boolean {
  const width = Math.max(
    document.body.scrollWidth,
    document.documentElement.scrollWidth,
    document.body.offsetWidth,
    document.documentElement.offsetWidth,
    document.documentElement.clientWidth
  );
  return width < 375;
}

// https://stackoverflow.com/questions/1038727/how-to-get-browser-width-using-javascript-code
// Based on CSS abswidthmax
export function isBigScreen(): boolean {
  const width = Math.max(
    document.body.scrollWidth,
    document.documentElement.scrollWidth,
    document.body.offsetWidth,
    document.documentElement.offsetWidth,
    document.documentElement.clientWidth
  );
  return width > 650;
}

export function getPlatformDump(): string {
  return (window.navigator.platform || '') + ': ' + (window.navigator.userAgent || '') + ': ' + (window.navigator.cookieEnabled ? 'W/COOKIES' : 'NO COOKIES');
}

export function setWindow(w: ReactWindow) {
  refs.window = w;
}

export function setDocument(d: ReactDocument) {
  refs.document = d;
}

export function setDeviceForTest(d: any) {
  refs.device = d;
}

export function setGA(g: any) {
  refs.ga = g;
}

export function setNavigator(n: any) {
  refs.navigator = n;
}

export function getWindow(): ReactWindow {
  return refs.window;
}

export function getDocument(): Document {
  return refs.document;
}

export function getDevice(): any {
  return refs.device;
}

export function getGA(): any {
  return refs.ga;
}

export function getGapi(): any {
  return refs.gapi;
}

export function getNavigator(): any {
  return refs.navigator;
}

export function getHistoryApi(): any {
  return refs.history;
}

export function getCheerio(): CheerioAPI {
  return refs.cheerio;
}

export function getAudioContext(): AudioContext|null {
  if (refs.audioContext) {
    return refs.audioContext;
  }
  try {
    refs.audioContext = new (getWindow().AudioContext as any || getWindow().webkitAudioContext as any)();
  } catch (err) {
    console.log('Web Audio API is not supported in this browser');
    refs.audioContext = null;
  }
  return refs.audioContext;
}

export function openWindow(url: string): any {
  window.open(url, '_system');
}

// Can't set it by default, since some browsers on high privacy throw an error when accessing window.localStorage
export function getLocalStorage(): Storage {
  if (refs.localStorage) {
    return refs.localStorage;
  }

  // Alert user if cookies disabled (after error display set up)
  // Based on https://github.com/Modernizr/Modernizr/blob/master/feature-detects/cookies.js
  try {
    const d = getDocument();
    d.cookie = 'cookietest=1';
    const ret = d.cookie.indexOf('cookietest=') !== -1;
    d.cookie = 'cookietest=1; expires=Thu, 01-Jan-1970 00:00:01 GMT';
    if (!ret) {
      throw new Error('Cookies disabled');
    }
    refs.localStorage = getWindow().localStorage;
  } catch (err) {
    console.error(err);
  } finally {
    if (!refs.localStorage) {
      refs.localStorage = {
        clear: () => null,
        getItem: (s: string) => null,
        key: (index: number|string) => null,
        length: 0,
        removeItem: () => null,
        setItem: () => null,
      } as Storage;
    }
    return refs.localStorage;
  }
}
