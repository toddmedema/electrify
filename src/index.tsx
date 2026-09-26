import React from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { store } from "./Store";
import App from "./App";
import { prefetchIcons } from "./helpers/OfflineData";
import "./app.scss";

const container = document.getElementById("root")!;
const root = createRoot(container);

const app = (
  <React.StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </React.StrictMode>
);

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

if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    let registered = false;
    const syncIcons = () => {
      if (!registered) {
        return;
      }
      // Icons are small and every screen uses them, so cache them for all users -- not just
      // installed apps -- before any game starts. The worker skips what it already has, so a
      // repeat load only pays for the manifest check.
      void prefetchIcons();
    };

    navigator.serviceWorker
      .register("/service-worker.js")
      .then(() => {
        registered = true;
        const installed = Boolean(
          (navigator as Navigator & { standalone?: boolean }).standalone ||
          window.matchMedia?.("(display-mode: standalone)").matches,
        );
        if (installed) {
          // Give the app shell, current screen and first interaction priority. The service worker
          // then fills every weather location and refreshes market data in the background.
          window.setTimeout(() => {
            navigator.serviceWorker.ready.then((registration) =>
              registration.active?.postMessage({ type: "SYNC_OFFLINE_DATA" }),
            );
          }, 3000);
        }
        window.setTimeout(syncIcons, 3000);
      })
      .catch((error) => console.warn("Couldn't enable offline play:", error));

    // A session that started offline only learns about new icons when connectivity returns.
    window.addEventListener("online", syncIcons);
  });
}
