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
