import { getAnalytics, logEvent as firebaseLogEvent } from "firebase/analytics";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
} from "firebase/auth";
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

/**
 * Signs the player out. The app hears about it through firebaseAppAuth.onAuthStateChanged the
 * same way it hears about signing in, so nothing needs to be reset here -- see App.tsx.
 */
export function logout(): Promise<void> {
  return signOut(firebaseAppAuth);
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
 * Reading scrollWidth / offsetWidth forces the browser to flush pending layout, and between the
 * compositor, the game card and the panes the answer is asked for the better part of a dozen
 * times per render -- which at FAST speed is a hundred renders a second, all for a number that
 * only moves when the window does. So it is measured once and kept until a resize says otherwise.
 * // https://stackoverflow.com/questions/1038727/how-to-get-browser-width-using-javascript-code
 */
let cachedViewportWidth: number | null = null;

function getViewportWidth(): number {
  if (cachedViewportWidth === null) {
    cachedViewportWidth = Math.max(
      document.body.scrollWidth,
      document.documentElement.scrollWidth,
      document.body.offsetWidth,
      document.documentElement.offsetWidth,
      document.documentElement.clientWidth,
    );
  }
  return cachedViewportWidth;
}

if (typeof window !== "undefined") {
  const invalidate = () => {
    cachedViewportWidth = null;
  };
  window.addEventListener("resize", invalidate);
  window.addEventListener("orientationchange", invalidate);
}

/**
 * Compact phone chrome belongs on every common phone width, not just devices narrower than an
 * old 375px breakpoint. Larger controls also matter most on coarse-pointer devices.
 *
 * @returns {boolean} - Returns true if the screen width is less than 375, otherwise false.
 */
export function isSmallScreen(): boolean {
  return getViewportWidth() < 600;
}

/**
 * This function checks if the screen size is large, based on the width of the document being > 650
 * // https://stackoverflow.com/questions/1038727/how-to-get-browser-width-using-javascript-code
 *
 * @returns {boolean} - Returns true if the screen width is greater than 650, otherwise false.
 */
export function isBigScreen(): boolean {
  return getViewportWidth() > 650;
}

/**
 * This function checks if the screen is wide enough to show Facilities and Insights side by
 * side without the bottom navigation -- keep in sync with $desktop_breakpoint in app.scss.
 *
 * @returns {boolean} - Returns true if the screen width is at least 1300, otherwise false.
 */
export function isDesktopScreen(): boolean {
  return getViewportWidth() >= 1300;
}

/**
 * Whether the in-game cards render as panes side by side -- with the app bar, and below the
 * desktop breakpoint the bottom nav, supplied by the layout around them -- rather than as one
 * full-screen card carrying its own chrome.
 *
 * True from $pane_breakpoint up: between there and the desktop breakpoint the layout is
 * Facilities pinned beside Insights or Events. Narrower portrait tablets keep the single-pane
 * navigation because a facility row and its controls do not fit in the default split.
 *
 * @returns {boolean} - Returns true if the screen is at least 1024px wide, otherwise false.
 */
export function isPaneLayout(): boolean {
  return getViewportWidth() >= 1024;
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
