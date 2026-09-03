import React from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { store } from "./Store";
import App from "./App";
import "./app.scss";

const container = document.getElementById("root")!;
const root = createRoot(container);

root.render(
  <React.StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </React.StrictMode>,
);

if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/service-worker.js")
      .then(() => {
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
      })
      .catch((error) => console.warn("Couldn't enable offline play:", error));
  });
}
