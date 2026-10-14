import React from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { store } from "./Store";
import App from "./App";
import { registerServiceWorker } from "./ServiceWorkerRegistration";
import "./app.scss";
import { getDesktop, isDesktopApp } from "./Desktop";

const container = document.getElementById("root")!;
const root = createRoot(container);

const app = (
  <React.StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </React.StrictMode>
);

function renderApp(): void {
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
const startDesktop: () => Promise<void> =
  process.env.REACT_APP_DESKTOP === "true"
    ? async () => {
        stopBootstrapQuit?.();
        stopBootstrapQuit = getDesktop()?.onBeforeQuit(() =>
          getDesktop()?.readyToQuit(true),
        );
        root.render(
          <p role="status" style={{ padding: 24 }}>
            Preparing saved games…
          </p>,
        );
        try {
          const { initializeDesktop } = await import(
            /* webpackChunkName: "electron" */ "./desktop/Runtime"
          );
          await initializeDesktop();
          stopBootstrapQuit?.();
          stopBootstrapQuit = undefined;
          renderApp();
        } catch {
          root.render(
            <div role="alert" style={{ padding: 24 }}>
              <h1>Saved games couldn't be restored</h1>
              <p>
                Your desktop backup has been kept. Retry before starting a game.
              </p>
              <button onClick={() => void startDesktop()}>Retry</button>
              <button onClick={() => void getDesktop()?.quit()}>Quit</button>
            </div>,
          );
        }
      }
    : async () => {};
const desktopApp = process.env.REACT_APP_DESKTOP === "true" && isDesktopApp();
if (desktopApp) void startDesktop();
else renderApp();

if (
  !desktopApp &&
  process.env.NODE_ENV === "production" &&
  "serviceWorker" in navigator
) {
  window.addEventListener("load", () => registerServiceWorker());
}
