import { getAnalytics, logEvent as firebaseLogEvent } from 'firebase/analytics';
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import withFirebaseAuth from 'react-with-firebase-auth';

const firebaseApp = initializeApp({
  apiKey: 'AIzaSyBCZX3pfJe65LU1Ei_ONj6Yw2eaMKsZX7g',
  authDomain: 'electrify-game.firebaseapp.com',
  databaseURL: 'https://electrify-game.firebaseio.com',
  projectId: 'electrify-game',
  storageBucket: 'electrify-game.appspot.com',
  messagingSenderId: '882673691459',
  appId: '1:882673691459:web:b6af63afe7ddf377a31df6',
  measurementId: 'G-M064W1XFDY',
});
export const firebaseAppAuth = getAuth(firebaseApp);
const providers = {
  googleProvider: new GoogleAuthProvider(),
};

export interface ReactWindow extends Window {
  platform?: string;
  VERSION?: string;
  AudioContext?: AudioContext;
  webkitAudioContext?: AudioContext;
  Promise?: any;
  test?: boolean;
}

const refs = {
  db: null as any,
  history: (typeof window.history !== 'undefined') ? window.history : {pushState: () => null},
  localStorage: null as (Storage|null),
  navigator: (typeof navigator !== 'undefined') ? navigator : null,
  audioContext: null,
};

export function logEvent(eventName: string, args?: object): void {
  firebaseLogEvent(getAnalytics(firebaseApp), eventName, args);
}

export function authWrapper(component: any): any {
  return withFirebaseAuth({
    providers,
    firebaseAppAuth,
  })(component);
}

export function getDb(): any {
  if (!refs.db) {
    refs.db = getFirestore(firebaseApp);
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

export function setNavigator(n: any) {
  refs.navigator = n;
}

export function getNavigator(): any {
  return refs.navigator;
}

export function getHistoryApi(): any {
  return refs.history;
}

export function getAudioContext(): AudioContext|null {
  if (refs.audioContext) {
    return refs.audioContext;
  }
  try {
    refs.audioContext = new (window.AudioContext as any)();
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
    document.cookie = 'cookietest=1';
    const ret = document.cookie.indexOf('cookietest=') !== -1;
    document.cookie = 'cookietest=1; expires=Thu, 01-Jan-1970 00:00:01 GMT';
    if (!ret) {
      throw new Error('Cookies disabled');
    }
    refs.localStorage = window.localStorage;
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
