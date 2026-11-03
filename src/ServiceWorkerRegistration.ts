import { prefetchBuild, prefetchIcons } from "./helpers/OfflineData";
import { isDesktopApp } from "./Desktop";

/** Long enough for the app shell, current screen and first interaction to take priority. */
export const BACKGROUND_CACHE_DELAY_MS = 3000;

/**
 * Registers the service worker, then warms its cache in the background. Every player gets the
 * deployed build and every icon; installed apps also get every weather location and fresh market
 * data.
 */
export function registerServiceWorker(win: Window = window): void {
  if (process.env.REACT_APP_DESKTOP === "true" && isDesktopApp()) return;
  const serviceWorker = win.navigator.serviceWorker;
  let registered = false;
  const syncAssets = () => {
    if (!registered) {
      return;
    }
    void prefetchBuild();
    // Icons are small and every screen uses them, so cache them for all users -- not just
    // installed apps -- before any game starts. The worker skips what it already has, so a
    // repeat load only pays for the manifest check.
    void prefetchIcons();
  };

  serviceWorker
    .register("/service-worker.js")
    .then(() => {
      registered = true;
      const installed = Boolean(
        (win.navigator as Navigator & { standalone?: boolean }).standalone ||
        win.matchMedia?.("(display-mode: standalone)").matches,
      );
      if (installed) {
        // The service worker fills every weather location and refreshes market data.
        win.setTimeout(() => {
          serviceWorker.ready.then((registration) =>
            registration.active?.postMessage({ type: "SYNC_OFFLINE_DATA" }),
          );
        }, BACKGROUND_CACHE_DELAY_MS);
      }
      win.setTimeout(syncAssets, BACKGROUND_CACHE_DELAY_MS);
    })
    .catch((error) => console.warn("Couldn't enable offline play:", error));

  // A session that started offline only learns about a new build when connectivity returns.
  win.addEventListener("online", syncAssets);
}
