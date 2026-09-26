import React from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { store } from "./Store";
import App from "./App";
import { registerServiceWorker } from "./ServiceWorkerRegistration";
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
  window.addEventListener("load", () => registerServiceWorker());
}
