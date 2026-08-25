import { ThemeProvider, StyledEngineProvider } from "@mui/material/styles";
import { useEffect } from "react";
import { Provider } from "react-redux";
import type { User } from "firebase/auth";
import CompositorContainer from "./components/CompositorContainer";
import UnitsProvider from "./components/base/UnitsContext";
import { navigateBack } from "./reducers/Card";
import { pauseAudio, resumeAudio } from "./reducers/Settings";
import { snackbarOpen } from "./reducers/UI";
import { firebaseAppAuth, getDevicePlatform } from "./Globals";
import { delta } from "./reducers/User";
import { SCENARIOS } from "./data/Scenarios";
import { startAutosave } from "./SaveGame";
import { store } from "./Store";
import theme from "./Theme";

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
        store.dispatch(delta({ uid: (user || ({} as Partial<User>)).uid }));
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
      <ThemeProvider theme={theme}>
        <Provider store={store}>
          {/* Above the compositor, whose shouldComponentUpdate would otherwise swallow a
              settings change that did not also change the card */}
          <UnitsProvider>
            <CompositorContainer store={store} />
          </UnitsProvider>
        </Provider>
      </ThemeProvider>
    </StyledEngineProvider>
  );
}
