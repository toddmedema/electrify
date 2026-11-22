import React from "react";
import { root } from "./Root";
import { Provider } from "react-redux";
import { store, useAppSelector } from "./Store";
import App from "./App";
import { registerServiceWorker } from "./ServiceWorkerRegistration";
import "./app.scss";
import { installFocusVisibility } from "./FocusVisibility";
import { getDesktop, isDesktopApp } from "./Desktop";
import { waitForAppStyles } from "./StartupStyles";
import { showBootstrapFailure } from "./StartupFailure";
import {
  prepareDesktopStartup,
  failDesktopStartup,
  finishStartup,
} from "./desktop/Startup";

installFocusVisibility();

function StartupHandoff({ seat = false }: { seat?: boolean }): null {
  const home = useAppSelector(
    (state) => !seat && state.card.name === "MAIN_MENU",
  );
  const loadingSaves = useAppSelector((state) => state.saves.loading);
  // Continue and Saves must be in place before the home menu measures its entrance.
  const waiting = home && loadingSaves;
  React.useLayoutEffect(() => {
    finishStartup({ home, waiting });
  }, [home, waiting]);
  return null;
}

const app = (
  <React.StrictMode>
    <Provider store={store}>
      <App />
      <StartupHandoff />
    </Provider>
  </React.StrictMode>
);

function renderApp(): void {
  void waitForAppStyles().then(renderStyledApp, showBootstrapFailure);
}

function renderStyledApp(): void {
  if (process.env.NODE_ENV !== "production") {
    // Dev-only perf instruments (docs/perf-plan.md B3/B4 and B6). The constant condition lets
    // webpack drop this branch, and the chunks it imports, from production builds.
    Promise.all([
      import("./testing/PerfCensus"),
      import("./testing/PerfOverlay"),
    ]).then(
      ([{ installPerfCensus }, { installPerfOverlay }]) => {
        root.render(installPerfCensus(store, app));
        installPerfOverlay();
      },
      (error) => {
        console.warn("Perf instruments unavailable:", error);
        root.render(app);
      },
    );
  } else {
    root.render(app);
  }
}

let stopBootstrapQuit: (() => void) | undefined;
const prepareAchievements = () =>
  import(/* webpackChunkName: "achievements" */ "./achievements/Runtime").then(
    ({ initializeAchievements }) => initializeAchievements(),
  );
const startDesktop: () => Promise<void> =
  process.env.REACT_APP_DESKTOP === "true"
    ? async () => {
        stopBootstrapQuit?.();
        stopBootstrapQuit = getDesktop()?.onBeforeQuit(() =>
          getDesktop()?.readyToQuit(true),
        );
        prepareDesktopStartup();
        try {
          await prepareAchievements();
          const { initializeDesktop } = await import(
            /* webpackChunkName: "electron" */ "./desktop/Runtime"
          );
          await initializeDesktop();
          stopBootstrapQuit?.();
          stopBootstrapQuit = undefined;
          renderApp();
        } catch {
          failDesktopStartup(
            () => void startDesktop(),
            () => void getDesktop()?.quit(),
          );
        }
      }
    : async () => {};
const desktopApp = process.env.REACT_APP_DESKTOP === "true" && isDesktopApp();
if (
  process.env.REACT_APP_DESKTOP === "true" &&
  window.electrifyCouch?.role === "seat"
) {
  void Promise.all([
    window.electrifyCouch.ready(),
    import(/* webpackChunkName: "couch-seat" */ "./couch/Seat"),
  ])
    .then(([, { default: Seat }]) => {
      root.render(
        <Provider store={store}>
          <Seat />
          <StartupHandoff seat />
        </Provider>,
      );
    })
    .catch(() => {
      document.getElementById("appStartup")?.remove();
      root.render(
        <div role="alert" style={{ padding: 24 }}>
          <p>This company could not finish loading.</p>
          <button
            style={{ minHeight: 44, padding: "8px 16px", font: "inherit" }}
            onClick={() => window.location.reload()}
          >
            Reload this company
          </button>
        </div>,
      );
    });
} else if (desktopApp) void startDesktop();
else {
  const startWeb = () => {
    void prepareAchievements()
      .then(renderApp)
      .catch(() => {
        document.getElementById("appStartup")?.remove();
        root.render(
          <div role="alert" style={{ padding: 24 }}>
            <h1>Electrify couldn't finish loading</h1>
            <p>Check your connection and try again.</p>
            <button
              style={{ minHeight: 44, padding: "8px 16px", font: "inherit" }}
              onClick={startWeb}
            >
              Retry
            </button>
          </div>,
        );
      });
  };
  startWeb();
}

if (
  !desktopApp &&
  process.env.NODE_ENV === "production" &&
  "serviceWorker" in navigator
) {
  if (document.readyState === "complete") registerServiceWorker();
  else
    window.addEventListener("load", () => registerServiceWorker(), {
      once: true,
    });
}

/** The lightweight title routes the first intent through the normal owning menu actions. */
export async function runHomeAction(
  action: keyof import("./components/views/MainMenu").DispatchProps,
  audio?: boolean,
): Promise<void> {
  await prepareAchievements();
  const { mapDispatchToProps } =
    await import("./components/views/MainMenuContainer");
  const actions = mapDispatchToProps(store.dispatch);
  if (action === "onAudioChange") actions.onAudioChange(!!audio);
  else actions[action]?.();
}
