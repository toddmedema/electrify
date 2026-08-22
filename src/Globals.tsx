import { getAnalytics, logEvent as firebaseLogEvent } from "firebase/analytics";
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { Firestore, getFirestore } from "firebase/firestore";

const firebaseApp = initializeApp({
  // Set by CI from a repo secret; falls back to the placeholder for local dev
  // (contact an admin for a key). Firebase web API keys are public by design --
  // access is controlled by Firestore rules and API key restrictions, not secrecy.
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY || "CONTACT-ADMIN-TO-GET-KEY",
  authDomain: "electrify-game.firebaseapp.com",
  databaseURL: "https://electrify-game.firebaseio.com",
  projectId: "electrify-game",
  storageBucket: "electrify-game.appspot.com",
  messagingSenderId: "882673691459",
  appId: "1:882673691459:web:b6af63afe7ddf377a31df6",
  measurementId: "G-M064W1XFDY",
});
export const firebaseAppAuth = getAuth(firebaseApp);
const provider = new GoogleAuthProvider();

export function login() {
  signInWithPopup(firebaseAppAuth, provider)
    .then(() => {
      // The signed in user reaches the app through firebaseAppAuth.onAuthStateChanged
      // (see App.tsx); nothing is needed here. Do not log the credential -- it carries an
      // access token, and the console is readable by anything running on the page.
    })
    .catch((error) => {
      console.error(
        "Auth error: ",
        error,
        GoogleAuthProvider.credentialFromError(error),
      );
    });
}

// The slice of the History API the game uses. Card navigation pushes a hash entry so the
// browser back button steps back through cards; anything without a history object (tests,
// non-browser hosts) gets a no-op.
interface HistoryApi {
  pushState: History["pushState"];
}

const refs = {
  db: null as Firestore | null,
  history:
    typeof window.history !== "undefined"
      ? (window.history as HistoryApi)
      : { pushState: () => undefined },
  localStorage: null as Storage | null,
  audioContext: null as AudioContext | null,
};

export function logEvent(eventName: string, args?: object): void {
  firebaseLogEvent(getAnalytics(firebaseApp), eventName, args);
}

export function getDb(): Firestore {
  if (!refs.db) {
    refs.db = getFirestore(firebaseApp);
  }
  return refs.db;
}

export function getDevicePlatform(): "web" {
  return "web";
}

/**
 * This function checks if the screen size is small, based on the width of the document being < 375
 * // https://stackoverflow.com/questions/1038727/how-to-get-browser-width-using-javascript-code
 *
 * @returns {boolean} - Returns true if the screen width is less than 375, otherwise false.
 */
export function isSmallScreen(): boolean {
  const width = Math.max(
    document.body.scrollWidth,
    document.documentElement.scrollWidth,
    document.body.offsetWidth,
    document.documentElement.offsetWidth,
    document.documentElement.clientWidth,
  );
  return width < 375;
}

/**
 * This function checks if the screen size is large, based on the width of the document being > 650
 * // https://stackoverflow.com/questions/1038727/how-to-get-browser-width-using-javascript-code
 *
 * @returns {boolean} - Returns true if the screen width is greater than 650, otherwise false.
 */
export function isBigScreen(): boolean {
  const width = Math.max(
    document.body.scrollWidth,
    document.documentElement.scrollWidth,
    document.body.offsetWidth,
    document.documentElement.offsetWidth,
    document.documentElement.clientWidth,
  );
  return width > 650;
}

/**
 * This function checks if the screen is wide enough to show Facilities, Finances and Forecasts
 * side by side instead of one at a time -- keep in sync with $desktop_breakpoint in app.scss.
 * Below this, panes render too narrow to be worth splitting into three columns.
 *
 * @returns {boolean} - Returns true if the screen width is at least 1300, otherwise false.
 */
export function isDesktopScreen(): boolean {
  const width = Math.max(
    document.body.scrollWidth,
    document.documentElement.scrollWidth,
    document.body.offsetWidth,
    document.documentElement.offsetWidth,
    document.documentElement.clientWidth,
  );
  return width >= 1300;
}

export function getHistoryApi(): HistoryApi {
  return refs.history;
}

export function getAudioContext(): AudioContext | null {
  if (refs.audioContext) {
    return refs.audioContext;
  }
  try {
    refs.audioContext = new window.AudioContext();
  } catch (_err) {
    console.warn("Web Audio API is not supported in this browser");
    refs.audioContext = null;
  }
  return refs.audioContext;
}

export function openWindow(url: string): void {
  window.open(url, "_system");
}

// Can't set it by default, since some browsers on high privacy throw an error when accessing window.localStorage
export function getLocalStorage(): Storage {
  if (refs.localStorage) {
    return refs.localStorage;
  }

  // Alert user if cookies disabled (after error display set up)
  // Based on https://github.com/Modernizr/Modernizr/blob/master/feature-detects/cookies.js
  try {
    document.cookie = "cookietest=1";
    const ret = document.cookie.indexOf("cookietest=") !== -1;
    document.cookie = "cookietest=1; expires=Thu, 01-Jan-1970 00:00:01 GMT";
    if (!ret) {
      throw new Error("Cookies disabled");
    }
    refs.localStorage = window.localStorage;
  } catch (err) {
    console.error(err);
  } finally {
    if (!refs.localStorage) {
      refs.localStorage = {
        clear: () => null,
        getItem: () => null,
        key: () => null,
        length: 0,
        removeItem: () => null,
        setItem: () => null,
      } as Storage;
    }
    return refs.localStorage;
  }
}
