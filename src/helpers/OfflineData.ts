import { LocationType } from "../Types";

/**
 * Asks the active service worker to cache everything needed to start a game at this location.
 * This is deliberately only a download: initializing the weather and market modules here would
 * replace the in-memory data for a game that may still be running.
 */
export async function prefetchScenarioData(
  location: LocationType,
): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    registration.active?.postMessage({
      type: "CACHE_SCENARIO_DATA",
      locationIds: [location.id, location.watershedId].filter(Boolean),
    });
  } catch {
    // Prefetching is only an optimization. The loading screen owns errors and retries when the
    // player actually asks to start the game.
  }
}

/**
 * Asks the active service worker to download every icon in the background. Icons are small and
 * shared by every screen, so this runs for all users at launch -- before any game starts -- not
 * just installed apps. The worker skips what it already has, so repeat calls are cheap.
 */
export async function prefetchIcons(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    registration.active?.postMessage({ type: "CACHE_ICONS" });
  } catch {
    // Prefetching is only an optimization. The service worker's fetch handler still caches any
    // icon the app requests while online.
  }
}
