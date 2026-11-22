import { useEffect, useState } from "react";
import type { LocationType } from "../../Types";
import { isDesktopApp } from "../../Desktop";
import { simulationDataRequest } from "../../helpers/SimulationDataIntegrity";
import { weatherLocationIds } from "../../helpers/WeatherLocations";
import { useOnline } from "./OnlineStatus";

async function availableWeatherIds(
  locations: readonly LocationType[],
): Promise<Set<string>> {
  if (typeof caches === "undefined") return new Set();
  const ids = [...new Set(locations.flatMap(weatherLocationIds))];
  const available = await Promise.all(
    ids.map(async (id) => {
      const url = `/data/weather/${id}.bin`;
      try {
        const response = await caches.match(url);
        if (!response?.ok) return;
        const { integrity } = simulationDataRequest(url);
        if (integrity) {
          const digest = await crypto.subtle.digest(
            "SHA-256",
            await response.arrayBuffer(),
          );
          const hash = btoa(String.fromCharCode(...new Uint8Array(digest)));
          if (integrity !== `sha256-${hash}`) return;
        }
        return id;
      } catch {
        // A read or integrity failure is equivalent to missing offline data.
        return undefined;
      }
    }),
  );
  return new Set(available.filter((id): id is string => id !== undefined));
}

/** Offline pickers promise only the locations the current build can read from Cache Storage. */
export function useOfflineWeather(
  locations: readonly LocationType[],
  selected?: LocationType,
): ((location: LocationType) => boolean) | undefined {
  const online = useOnline();
  const offline = !online && !isDesktopApp();
  const [available, setAvailable] = useState<Set<string>>();
  useEffect(() => {
    if (!offline) {
      setAvailable(undefined);
      return;
    }
    let active = true;
    void availableWeatherIds(
      selected ? [...locations, selected] : locations,
    ).then((ids) => {
      if (active) setAvailable(ids);
    });
    return () => {
      active = false;
    };
  }, [offline, locations, selected]);

  return offline
    ? (location) =>
        !weatherLocationIds(
          selected?.id === location.id ? selected : location,
        ).every((id) => available?.has(id))
    : undefined;
}
