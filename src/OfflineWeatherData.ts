import type { LocationType } from "./Types";
import { isDesktopApp } from "./Desktop";
import { simulationDataRequest } from "./helpers/SimulationDataIntegrity";
import { weatherLocationIds } from "./helpers/WeatherLocations";

export function offlineWeatherFile(id: string) {
  const { integrity } = simulationDataRequest(`/data/weather/${id}.bin`);
  return integrity ? { id, integrity } : undefined;
}

export async function prefetchLocationWeather(location: LocationType) {
  if (isDesktopApp() || !navigator.serviceWorker) return;
  try {
    const locationIds = weatherLocationIds(location);
    const weather = locationIds.flatMap((id) => offlineWeatherFile(id) ?? []);
    const registration = await navigator.serviceWorker.ready;
    const worker =
      registration.installing ?? registration.waiting ?? registration.active;
    worker?.postMessage({
      type: "CACHE_SCENARIO_DATA",
      locationIds, // Older active workers can still prefetch missing files during an update.
      weather,
    });
  } catch {
    // Loading can retry a failed prefetch.
  }
}
