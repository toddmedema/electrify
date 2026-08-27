import { ThemeProvider, StyledEngineProvider } from "@mui/material/styles";
import { useEffect, useLayoutEffect, useState } from "react";
import { Provider } from "react-redux";
import type { User } from "firebase/auth";
import CompositorContainer from "./components/CompositorContainer";
import UnitsProvider from "./components/base/UnitsContext";
import { navigate, navigateBack } from "./reducers/Card";
import { pauseAudio, resumeAudio } from "./reducers/Settings";
import { snackbarOpen } from "./reducers/UI";
import { firebaseAppAuth, getDevicePlatform } from "./Globals";
import { delta, loadProfile, reset } from "./reducers/User";
import { SCENARIOS } from "./data/Scenarios";
import { delta as gameDelta } from "./reducers/Game";
import { startAutosave } from "./SaveGame";
import { store, useAppSelector } from "./Store";
import {
  createAppTheme,
  prefersDarkMode,
  resolveThemeMode,
  setThemeMode,
} from "./Theme";
import { ThemeChoiceType } from "./Types";
import { InstallPromptProvider } from "./components/base/InstallAppButton";

// Cordova's lifecycle events, only ever fired in an app build. Returns its own teardown so the
// listeners go away with the rest of them rather than outliving the component that added them.
function setupDevice(): () => void {
  const platform = getDevicePlatform();
  // Platform-specific styles
  document.body.className += " " + platform;

  const onBackButton = () => store.dispatch(navigateBack());
  const onPause = () => store.dispatch(pauseAudio());
  const onResume = () => store.dispatch(resumeAudio());

  document.addEventListener("backbutton", onBackButton, false);
  document.addEventListener("pause", onPause, false);
  document.addEventListener("resume", onResume, false);

  return () => {
    document.removeEventListener("backbutton", onBackButton, false);
    document.removeEventListener("pause", onPause, false);
    document.removeEventListener("resume", onResume, false);
  };
}

function setupStorage(document: Document) {
  // Alert user if cookies disabled
  // Based on https://github.com/Modernizr/Modernizr/blob/master/feature-detects/cookies.js
  try {
    document.cookie = "cookietest=1";
    const ret = document.cookie.indexOf("cookietest=") !== -1;
    document.cookie = "cookietest=1; expires=Thu, 01-Jan-1970 00:00:01 GMT";
    if (!ret) {
      throw new Error("Cookies disabled");
    }
  } catch (_err) {
    setTimeout(() => {
      store.dispatch(
        snackbarOpen("Please enable cookies for the app to function properly."),
      );
    }, 0);
  }
}

/**
 * Paints the app in the palette the player asked for.
 *
 * Three things have to agree on it and none of them can be reached the same way: MUI's own
 * components read a theme through context, everything styled by hand reads custom properties off
 * <html>, and the charts paint to a canvas and so have to be told in JavaScript (see Theme.tsx).
 * This is the one place that knows, so it sets all three.
 *
 * Inside the Provider because it reads the setting from the store, and above everything else
 * because a palette change has to reach the whole tree.
 */
function ThemedApp(props: { children: React.JSX.Element }): React.JSX.Element {
  const choice: ThemeChoiceType = useAppSelector(
    (state) => state.settings.theme,
  );
  // "System" is a standing instruction rather than a value, and the system can change its mind
  // while the game is open - at sunset, on a schedule, or because the player just flipped it
  const [systemDark, setSystemDark] = useState(prefersDarkMode);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(query.matches);
    query.addEventListener("change", onChange);
    // The listener can only have missed something between the first render and here
    onChange();
    return () => query.removeEventListener("change", onChange);
  }, []);

  const mode =
    choice === "system"
      ? systemDark
        ? "dark"
        : "light"
      : resolveThemeMode(choice);
  // In a layout effect rather than in the render body: telling Theme.tsx wakes every chart
  // that subscribed to it, and waking a component while another one is rendering is exactly
  // what React warns about. Before paint, so neither of the two lands a frame late
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = mode;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", mode === "dark" ? "#121212" : "#ffffff");
    setThemeMode(mode);
  }, [mode]);

  return (
    <ThemeProvider theme={createAppTheme(mode)}>{props.children}</ThemeProvider>
  );
}

function OfflineNotice(): React.JSX.Element | null {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online ? null : (
    <div className="offlineBanner" role="status">
      Offline — your game stays saved on this device. Online features will
      reconnect automatically.
    </div>
  );
}

export default function App() {
  /**
   * All of this used to run in the component body. A function component's body runs on every
   * render, and index.tsx mounts App inside React.StrictMode, which deliberately invokes it twice
   * on mount in development -- so the visibility listener was registered twice and every hide or
   * show dispatched pause/resume twice, the auth subscription was opened twice, and the cookie
   * check ran twice. In an effect with a teardown, StrictMode's mount/unmount/mount cycle nets out
   * to exactly one of each, and nothing is left behind if App ever unmounts.
   */
  useEffect(() => {
    setupStorage(document);

    // Shared score links land on the relevant challenge instead of dropping a new player at an
    // unexplained title screen. Tutorial ids still use the guided mission list.
    const sharedScenarioId = Number(
      new URLSearchParams(window.location.search).get("scenario"),
    );
    const sharedScenario = SCENARIOS.find(
      (scenario) => scenario.id === sharedScenarioId && !scenario.tutorialSteps,
    );
    if (sharedScenario) {
      store.dispatch(gameDelta({ scenarioId: sharedScenario.id }));
      store.dispatch(navigate("NEW_GAME_DETAILS"));
    }

    const onPopState = (e: PopStateEvent) => {
      store.dispatch(navigateBack());
      e.preventDefault();
    };
    window.addEventListener("popstate", onPopState);

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        store.dispatch(pauseAudio());
      } else if (document.visibilityState === "visible") {
        store.dispatch(resumeAudio());
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange, false);

    // Registered here rather than next to the store because the tutorial lookup needs the
    // scenarios, and reducers/Game already reaches back into SaveGame -- App sits above both, so
    // nothing can cycle. Tutorials are excluded: they're short, restoring a mid-walkthrough step
    // isn't worth the complexity, and it means starting one can't clobber a real save.
    const stopAutosave = startAutosave(
      store,
      (scenarioId: number) =>
        !SCENARIOS.find((s) => s.id === scenarioId)?.tutorialSteps,
    );

    // Returns its own unsubscribe, which was previously dropped on the floor
    const unsubscribeAuth = firebaseAppAuth.onAuthStateChanged(
      (user: User | null) => {
        if (!user) {
          // Signed out, or never signed in: drop the whole slice rather than only the uid, so one
          // player's name and bests can't linger into the next player's session
          store.dispatch(reset());
          return;
        }
        // The provider's name is only a seed for the name dialog. The leaderboard name is the one
        // claimed against users/{uid}, which is what loadProfile goes and reads
        store.dispatch(
          delta({
            uid: user.uid,
            googleDisplayName: user.displayName || undefined,
          }),
        );
        store.dispatch(
          loadProfile({ uid: user.uid, googleDisplayName: user.displayName }),
        );
      },
    );

    // Only triggers on app builds. Cordova fires deviceready once, so the listeners it installs
    // have to be torn down through the teardown it hands back rather than by removing this one.
    let teardownDevice: (() => void) | undefined;
    const onDeviceReady = () => {
      teardownDevice = setupDevice();
    };
    document.addEventListener("deviceready", onDeviceReady, false);

    return () => {
      window.removeEventListener("popstate", onPopState);
      document.removeEventListener(
        "visibilitychange",
        onVisibilityChange,
        false,
      );
      stopAutosave();
      unsubscribeAuth();
      document.removeEventListener("deviceready", onDeviceReady, false);
      teardownDevice?.();
    };
  }, []);

  return (
    <StyledEngineProvider injectFirst>
      <Provider store={store}>
        <ThemedApp>
          {/* Above the compositor, whose shouldComponentUpdate would otherwise swallow a
              settings change that did not also change the card */}
          <InstallPromptProvider>
            <OfflineNotice />
            <UnitsProvider>
              <CompositorContainer store={store} />
            </UnitsProvider>
          </InstallPromptProvider>
        </ThemedApp>
      </Provider>
    </StyledEngineProvider>
  );
}
