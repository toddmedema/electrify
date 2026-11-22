import { prefetchBuild, prefetchIcons } from "./helpers/OfflineData";
import { isDesktopApp } from "./Desktop";

/** Long enough for the app shell, current screen and first interaction to take priority. */
export const BACKGROUND_CACHE_DELAY_MS = 3000;
const registeringWindows = new WeakSet<Window>();

/**
 * Registers the service worker, then warms its cache in the background. Every player gets the
 * deployed build and every icon; installed apps also get weather for the official scenarios,
 * fresh market data, and every audio file.
 */
export function registerServiceWorker(win: Window = window): void {
  if (process.env.REACT_APP_DESKTOP === "true" && isDesktopApp()) return;
  // Both the lightweight title and the full game can reach this boundary in one document.
  if (registeringWindows.has(win)) return;
  registeringWindows.add(win);
  const serviceWorker = win.navigator.serviceWorker;
  let registered = false;
  let installed = Boolean(
    (win.navigator as Navigator & { standalone?: boolean }).standalone ||
    win.matchMedia?.("(display-mode: standalone)").matches,
  );
  const onInstalled = () => {
    installed = true;
    syncAssets();
  };
  win.addEventListener("appinstalled", onInstalled);
  const syncAssets = () => {
    if (!registered) {
      return;
    }
    void prefetchBuild();
    // Icons are small and every screen uses them, so cache them for all users -- not just
    // installed apps -- before any game starts. The worker skips what it already has, so a
    // repeat load only pays for the manifest check.
    void prefetchIcons();
    if (installed) {
      void Promise.all([
        serviceWorker.ready,
        import("./OfficialOfflineWeather"),
      ])
        .then(([registration, { officialOfflineWeather }]) =>
          registration.active?.postMessage({
            type: "SYNC_OFFICIAL_OFFLINE_DATA",
            weather: officialOfflineWeather(),
          }),
        )
        .catch(() => undefined); // The next online launch can retry the warm-up.
    }
  };

  serviceWorker
    .register("/service-worker.js")
    .then(() => {
      registered = true;
      win.setTimeout(syncAssets, BACKGROUND_CACHE_DELAY_MS);
    })
    .catch((error) => {
      registeringWindows.delete(win);
      win.removeEventListener("appinstalled", onInstalled);
      win.removeEventListener("online", syncAssets);
      console.warn("Couldn't enable offline play:", error);
    });

  // A session that started offline only learns about a new build when connectivity returns.
  win.addEventListener("online", syncAssets);
}
