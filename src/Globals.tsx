import type { Analytics } from "firebase/analytics";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import { Firestore, getFirestore } from "firebase/firestore";
import { isDesktopApp } from "./Desktop";
import { APP_VERSION } from "./AppVersion";
import { subscribeAfterSignIn } from "./MailingList";

const firebaseApp =
  process.env.REACT_APP_DESKTOP === "true" &&
  (isDesktopApp() || typeof window === "undefined")
    ? undefined
    : initializeApp({
        // Set by CI from a repo secret; falls back to the placeholder for local dev
        // (contact an admin for a key). Firebase web API keys are public by design --
        // access is controlled by Firestore rules and API key restrictions, not secrecy.
        apiKey:
          process.env.REACT_APP_FIREBASE_API_KEY || "CONTACT-ADMIN-TO-GET-KEY",
        authDomain: "electrify-game.firebaseapp.com",
        databaseURL: "https://electrify-game.firebaseio.com",
        projectId: "electrify-game",
        storageBucket: "electrify-game.appspot.com",
        messagingSenderId: "882673691459",
        appId: "1:882673691459:web:b6af63afe7ddf377a31df6",
        measurementId: "G-M064W1XFDY",
      });
// Desktop accounts come from Steam; even constructing Firebase Auth starts web transport.
export const firebaseAppAuth = firebaseApp ? getAuth(firebaseApp) : undefined;
const provider = new GoogleAuthProvider();

export interface SignInOptions {
  mailingList?: boolean;
}

export function login(options: SignInOptions = {}): Promise<boolean> {
  if (process.env.REACT_APP_DESKTOP === "true" && isDesktopApp())
    return Promise.resolve(false);
  return signInWithPopup(firebaseAppAuth!, provider)
    .then((credential) => {
      if (options.mailingList) {
        // Auth listeners can close the dialog before signup finishes.
        // Keep signup independent of login and cloud sync.
        void subscribeAfterSignIn(firebaseAppAuth!, credential.user).catch(
          () => undefined,
        );
      }
      // The signed in user reaches the app through firebaseAppAuth.onAuthStateChanged
      // (see App.tsx); nothing is needed here. Do not log the credential -- it carries an
      // access token, and the console is readable by anything running on the page.
      return true;
    })
    .catch((error) => {
      // Firebase errors can include OAuth credentials; only log the diagnostic code.
      console.error("Auth error:", error.code);
      return false;
    });
}

/**
 * Signs the player out. The app hears about it through firebaseAppAuth.onAuthStateChanged the
 * same way it hears about signing in, so nothing needs to be reset here -- see App.tsx.
 */
export function logout(): Promise<void> {
  if (process.env.REACT_APP_DESKTOP === "true" && isDesktopApp())
    return Promise.resolve();
  return signOut(firebaseAppAuth!);
}

// The slice of the History API the game uses. Card navigation pushes a hash entry so the
// browser back button steps back through cards; anything without a history object (tests,
// non-browser hosts) gets a no-op.
interface HistoryApi {
  pushState: History["pushState"];
  replaceState: History["replaceState"];
  back: History["back"];
}

const refs = {
  analytics: null as Analytics | null,
  db: null as Firestore | null,
  history:
    typeof window !== "undefined" && typeof window.history !== "undefined"
      ? (window.history as HistoryApi)
      : {
          pushState: () => undefined,
          replaceState: () => undefined,
          back: () => undefined,
        },
  localStorage: null as Storage | null,
  audioContext: null as AudioContext | null,
};

let analyticsModule: Promise<typeof import("firebase/analytics")> | undefined;

/**
 * Logs a Google Analytics event, initializing analytics on first use once the browser is online.
 *
 * getAnalytics() kicks off a background registration with Firebase Installations, and while the
 * page is offline that registration fails inside the SDK (installations/app-offline). The SDK
 * keeps the rejected promise without a handler, so it surfaces as an unhandled rejection, which
 * the dev server's error overlay turns into a red screen over the whole game -- the manual
 * included, even though nothing in it needs the network. So initialization waits until the
 * browser reports being online, and the first event after that brings analytics up for good.
 *
 * Only the initialization is gated. Once the SDK is up, events keep being handed to it while
 * offline: a player who started online stays measured across a dropout, and the SDK's own
 * logEvent already catches its internal rejections. getAnalytics() is the only entry point that
 * does not.
 *
 * Chunk-load failures and synchronous SDK throws are caught below. A background registration
 * that fails while the browser still claims to be online (an ad blocker on the Google endpoints,
 * a captive portal, DNS) rejects that way and is out of reach;
 * outside the dev overlay it is a console line rather than anything the game reacts to.
 */
export function logEvent(eventName: string, args?: object): void {
  if (
    (process.env.REACT_APP_DESKTOP === "true" && isDesktopApp()) ||
    !firebaseApp
  )
    return;
  if (!refs.analytics && typeof navigator !== "undefined" && !navigator.onLine)
    return;
  // Share one SDK load; events queued during it keep their order without delaying gameplay.
  analyticsModule ??= import(
    /* webpackChunkName: "analytics" */ "firebase/analytics"
  );
  void analyticsModule
    .then(({ getAnalytics, logEvent: firebaseLogEvent }) => {
      if (!refs.analytics) {
        // Connectivity can change while the chunk is loading.
        if (typeof navigator !== "undefined" && !navigator.onLine) return;
        refs.analytics = getAnalytics(firebaseApp);
      }
      firebaseLogEvent(refs.analytics, eventName, {
        ...args,
        app_version: APP_VERSION,
      });
    })
    .catch(() => {
      // A failed chunk load or SDK initialization remains retryable on the next event.
      analyticsModule = undefined;
    });
}

export function getDb(): Firestore {
  if (
    !firebaseApp ||
    (process.env.REACT_APP_DESKTOP === "true" && isDesktopApp())
  )
    throw new Error("Web services are unavailable in the desktop game.");
  if (!refs.db) {
    refs.db = getFirestore(firebaseApp);
  }
  return refs.db;
}

export function getDevicePlatform(): "web" {
  return "web";
}

/**
 * Breakpoints follow the layout viewport, independent of overflowing page content. Cache the
 * dimensions until resize rather than measuring document layout on every game tick.
 */
let cachedViewportWidth: number | null = null;
let cachedViewportHeight: number | null = null;

function getViewportWidth(): number {
  if (cachedViewportWidth === null) {
    cachedViewportWidth =
      window.innerWidth || document.documentElement.clientWidth;
  }
  return cachedViewportWidth;
}

function getViewportHeight(): number {
  if (cachedViewportHeight === null) {
    cachedViewportHeight =
      window.innerHeight || document.documentElement.clientHeight;
  }
  return cachedViewportHeight;
}

if (typeof window !== "undefined") {
  const invalidate = () => {
    cachedViewportWidth = null;
    cachedViewportHeight = null;
  };
  window.addEventListener("resize", invalidate);
  window.addEventListener("orientationchange", invalidate);
}

/**
 * From this width the game workspace opens tools in side columns beside the fleet, and the app
 * bar folds its status row into the top bar so the window gains one row of game.
 */
export const SIDE_LAYOUT_MIN_WIDTH = 1300;
export const SIDE_LAYOUT_MEDIA = `(min-width:${SIDE_LAYOUT_MIN_WIDTH}px)`;

export function isBigScreen(): boolean {
  return getViewportWidth() >= 700;
}

/**
 * Wide enough to show Facilities and Insights side by side without the bottom navigation.
 * Keep in sync with $desktop_breakpoint in app.scss.
 */
export function isDesktopScreen(): boolean {
  return getViewportWidth() >= SIDE_LAYOUT_MIN_WIDTH;
}

/**
 * Whether the in-game cards render as panes side by side -- with the app bar, and below the
 * desktop breakpoint the bottom nav, supplied by the layout around them -- rather than as one
 * full-screen card carrying its own chrome.
 *
 * True from $pane_breakpoint up: between there and the desktop breakpoint the layout is
 * Facilities pinned beside Insights or Events. Narrower portrait tablets keep the single-pane
 * navigation because a facility row and its controls do not fit in the default split. Unfolded
 * foldables are the exception: at least 700x600 and near-square, each pane still gets about a
 * phone's width. Keep in sync with $pane_media in app.scss.
 */
export function isPaneLayout(): boolean {
  const width = getViewportWidth();
  if (width >= 1024) {
    return true;
  }
  const height = getViewportHeight();
  const aspectRatio = width / height;
  return (
    width >= 700 &&
    height >= 600 &&
    aspectRatio >= 4 / 5 &&
    aspectRatio <= 5 / 4
  );
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
  if (process.env.REACT_APP_DESKTOP === "true" && isDesktopApp()) {
    window.open(new URL(url, "https://electrifygame.com").href, "_blank");
    return;
  }
  window.open(url, "_system");
}

// Can't set it by default, since some browsers on high privacy throw an error when accessing window.localStorage
export function getLocalStorage(): Storage {
  if (typeof window === "undefined") {
    return {
      length: 0,
      clear: () => {},
      getItem: () => null,
      key: () => null,
      removeItem: () => {},
      setItem: () => {},
    };
  }
  if (refs.localStorage) {
    return refs.localStorage;
  }

  // Alert user if cookies disabled (after error display set up)
  // Based on https://github.com/Modernizr/Modernizr/blob/master/feature-detects/cookies.js
  try {
    if (process.env.REACT_APP_DESKTOP === "true" && isDesktopApp()) {
      refs.localStorage = window.localStorage;
      return refs.localStorage;
    }
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
